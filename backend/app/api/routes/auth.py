from __future__ import annotations

import contextlib
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field, field_validator

from app.core.concurrency import run_blocking
from app.core.dependencies import (
    get_auth_service,
    get_optional_session_context,
    require_csrf,
)
from app.core.errors import (
    AuthEmailNotAllowedError,
    AuthRequiredError,
    InvalidTimezoneError,
    OriginValidationError,
)
from app.core.request_security import validate_browser_origin
from app.core.security import (
    CSRF_COOKIE,
    REFRESH_TOKEN_COOKIE,
    clear_csrf_cookie,
    clear_session_cookies,
    ensure_csrf_cookie,
    set_session_cookies,
)
from app.core.settings import Settings, get_settings
from app.db.engine import user_connection_scope
from app.db.repositories import (
    SessionContext,
    ensure_inbox_group,
    get_session_context,
    get_user,
    is_email_allowed,
    update_user_timezone,
    upsert_user,
)
from app.services.auth import AuthenticatedSession, AuthService, LocalDevAuthService

router = APIRouter()

LOCAL_DEV_AUTH_EMAIL = "local-dev@gust.local"

SettingsDep = Annotated[Settings, Depends(get_settings)]
OptionalSessionContextDep = Annotated[
    SessionContext | None,
    Depends(get_optional_session_context),
]
RequiredSessionContextDep = Annotated[SessionContext, Depends(require_csrf)]
AuthServiceDep = Annotated[AuthService, Depends(get_auth_service)]


class UserSummary(BaseModel):
    id: str
    email: str
    display_name: str | None


class SessionStatusResponse(BaseModel):
    signed_in: bool
    user: UserSummary | None = None
    timezone: str | None = None
    inbox_group_id: str | None = None
    csrf_token: str | None = None


class TimezoneUpdateRequest(BaseModel):
    timezone: str


class PasswordSignInRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=256)

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if "@" not in normalized or any(char.isspace() for char in normalized):
            raise ValueError("Enter a valid email address.")
        return normalized


@router.get("", response_model=SessionStatusResponse)
async def get_session_status(
    request: Request,
    response: Response,
    session_context: OptionalSessionContextDep,
    settings: SettingsDep,
) -> SessionStatusResponse:
    if session_context is None:
        clear_session_cookies(response, settings)
        clear_csrf_cookie(response, settings)
        return SessionStatusResponse(signed_in=False)

    csrf_token = ensure_csrf_cookie(response, settings, request.cookies.get(CSRF_COOKIE))
    return _build_session_status_response(session_context, csrf_token)


@router.post("/login", response_model=SessionStatusResponse)
async def password_sign_in(
    payload: PasswordSignInRequest,
    request: Request,
    response: Response,
    settings: SettingsDep,
    auth_service: AuthServiceDep,
) -> SessionStatusResponse:
    if settings.gust_dev_mode or isinstance(auth_service, LocalDevAuthService):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")
    # No session exists yet, so there is no CSRF token to check. Requiring a trusted
    # Origin/Referer blocks cross-site login CSRF instead.
    if not validate_browser_origin(request, settings):
        raise OriginValidationError()
    auth_service.ensure_configured()

    session = await auth_service.sign_in_with_password(
        email=payload.email,
        password=payload.password,
    )

    try:
        session_context = await run_blocking(
            _bootstrap_allowed_session,
            settings.database_url,
            session,
        )
    except AuthEmailNotAllowedError:
        await _best_effort_revoke_refresh_token(auth_service, session.tokens.refresh_token)
        raise

    if session_context is None:
        raise AuthRequiredError("Authenticated user could not be resolved locally.")

    set_session_cookies(response, settings, session.tokens)
    csrf_token = ensure_csrf_cookie(response, settings, request.cookies.get(CSRF_COOKIE))
    return _build_session_status_response(session_context, csrf_token)


@router.post("/dev-login", response_model=SessionStatusResponse)
async def local_dev_login(
    request: Request,
    response: Response,
    settings: SettingsDep,
    auth_service: AuthServiceDep,
) -> SessionStatusResponse:
    if not settings.gust_dev_mode:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")

    if not isinstance(auth_service, LocalDevAuthService):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")
    session = auth_service.create_dev_session()

    try:
        session_context = await run_blocking(
            _bootstrap_allowed_session,
            settings.database_url,
            session,
        )
    except AuthEmailNotAllowedError:
        await _best_effort_revoke_refresh_token(auth_service, session.tokens.refresh_token)
        raise

    if session_context is None:
        raise AuthRequiredError("Authenticated user could not be resolved locally.")

    set_session_cookies(response, settings, session.tokens)
    csrf_token = ensure_csrf_cookie(response, settings, request.cookies.get(CSRF_COOKIE))
    return _build_session_status_response(session_context, csrf_token)


@router.post("/logout")
async def logout(
    response: Response,
    request: Request,
    session_context: RequiredSessionContextDep,
    settings: SettingsDep,
    auth_service: AuthServiceDep,
) -> dict[str, bool]:
    del session_context
    refresh_token = request.cookies.get(REFRESH_TOKEN_COOKIE)
    clear_session_cookies(response, settings)
    clear_csrf_cookie(response, settings)

    if refresh_token:
        with contextlib.suppress(Exception):
            await auth_service.revoke_refresh_token(refresh_token=refresh_token)

    return {"signed_out": True}


@router.put("/timezone", response_model=SessionStatusResponse)
async def update_timezone(
    payload: TimezoneUpdateRequest,
    request: Request,
    response: Response,
    session_context: RequiredSessionContextDep,
    settings: SettingsDep,
) -> SessionStatusResponse:
    _validate_timezone(payload.timezone)
    updated_context = await run_blocking(
        _update_user_timezone,
        settings.database_url,
        session_context.user.id,
        payload.timezone,
    )

    csrf_token = ensure_csrf_cookie(response, settings, request.cookies.get(CSRF_COOKIE))
    return _build_session_status_response(updated_context, csrf_token)


def _update_user_timezone(database_url: str, user_id: str, timezone: str) -> SessionContext:
    with user_connection_scope(database_url, user_id=user_id) as connection:
        user = update_user_timezone(connection, user_id=user_id, timezone=timezone)
        if user is None:
            raise AuthRequiredError("Authenticated user could not be updated locally.")
        inbox = ensure_inbox_group(connection, user_id=user_id)
    return SessionContext(user=user, inbox_group_id=inbox.id)


def _build_session_status_response(
    session_context: SessionContext,
    csrf_token: str,
) -> SessionStatusResponse:
    return SessionStatusResponse(
        signed_in=True,
        user=UserSummary(
            id=session_context.user.id,
            email=session_context.user.email,
            display_name=session_context.user.display_name,
        ),
        timezone=session_context.user.timezone,
        inbox_group_id=session_context.inbox_group_id,
        csrf_token=csrf_token,
    )


def _bootstrap_allowed_session(
    database_url: str,
    session: AuthenticatedSession,
) -> SessionContext | None:
    with user_connection_scope(database_url, user_id=session.identity.user_id) as connection:
        if not is_email_allowed(connection, email=session.identity.email):
            raise AuthEmailNotAllowedError()
        _bootstrap_user_session(connection, session)
        return get_session_context(connection, session.identity.user_id)


def _bootstrap_user_session(connection, session: AuthenticatedSession) -> None:
    existing_user = get_user(connection, session.identity.user_id)
    upsert_user(
        connection,
        user_id=session.identity.user_id,
        email=session.identity.email,
        display_name=session.identity.display_name,
        timezone=existing_user.timezone if existing_user is not None else "UTC",
    )
    ensure_inbox_group(connection, user_id=session.identity.user_id)


async def _best_effort_revoke_refresh_token(
    auth_service: AuthService,
    refresh_token: str | None,
) -> None:
    if not refresh_token:
        return

    try:
        await auth_service.revoke_refresh_token(refresh_token=refresh_token)
    except Exception:
        return


def _validate_timezone(timezone: str) -> None:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    try:
        ZoneInfo(timezone)
    except ZoneInfoNotFoundError as exc:
        raise InvalidTimezoneError() from exc
