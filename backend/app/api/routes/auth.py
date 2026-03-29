from __future__ import annotations

# ruff: noqa: UP045
from typing import Annotated, Optional
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.core.dependencies import (
    get_auth_service,
    get_optional_session_context,
    require_csrf,
)
from app.core.errors import (
    AuthEmailNotAllowedError,
    AuthRequiredError,
    CsrfValidationError,
    InvalidTimezoneError,
    UpstreamAuthError,
)
from app.core.security import (
    CSRF_COOKIE,
    OAUTH_CODE_VERIFIER_COOKIE,
    OAUTH_STATE_COOKIE,
    REFRESH_TOKEN_COOKIE,
    clear_csrf_cookie,
    clear_oauth_code_verifier_cookie,
    clear_oauth_state_cookie,
    clear_session_cookies,
    ensure_csrf_cookie,
    generate_oauth_state_token,
    generate_pkce_challenge,
    set_oauth_code_verifier_cookie,
    set_oauth_state_cookie,
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
from app.services.auth import AuthenticatedSession, SupabaseAuthService

router = APIRouter()

LOCAL_DEV_AUTH_EMAIL = "local-dev@gust.local"
LOCAL_DEV_AUTH_PASSWORD = "gust-local-dev-password"
LOCAL_DEV_AUTH_DISPLAY_NAME = "Local Dev User"

SettingsDep = Annotated[Settings, Depends(get_settings)]
OptionalSessionContextDep = Annotated[
    Optional[SessionContext],
    Depends(get_optional_session_context),
]
RequiredSessionContextDep = Annotated[SessionContext, Depends(require_csrf)]
AuthServiceDep = Annotated[SupabaseAuthService, Depends(get_auth_service)]


class UserSummary(BaseModel):
    id: str
    email: str
    display_name: Optional[str]


class SessionStatusResponse(BaseModel):
    signed_in: bool
    user: Optional[UserSummary] = None
    timezone: Optional[str] = None
    inbox_group_id: Optional[str] = None
    csrf_token: Optional[str] = None


class TimezoneUpdateRequest(BaseModel):
    timezone: str


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


@router.get("/google/start")
async def start_google_sign_in(
    settings: SettingsDep,
    auth_service: AuthServiceDep,
) -> RedirectResponse:
    auth_service.ensure_configured()
    pkce_challenge = generate_pkce_challenge()
    state_token = generate_oauth_state_token()
    response = RedirectResponse(
        url=auth_service.build_google_authorize_url(
            code_challenge=pkce_challenge.challenge,
            state=state_token,
        ),
        status_code=302,
    )
    set_oauth_code_verifier_cookie(response, settings, pkce_challenge)
    set_oauth_state_cookie(response, settings, state_token)
    return response


@router.get("/callback")
async def auth_callback(
    request: Request,
    settings: SettingsDep,
    auth_service: AuthServiceDep,
    code: str = Query(...),
    state: str = Query(...),
) -> RedirectResponse:
    auth_service.ensure_configured()

    code_verifier = request.cookies.get(OAUTH_CODE_VERIFIER_COOKIE)
    if not code_verifier:
        raise CsrfValidationError("OAuth PKCE verifier was missing or expired.")
    state_token = request.cookies.get(OAUTH_STATE_COOKIE)
    if not state_token or state != state_token:
        raise CsrfValidationError("OAuth state was missing, expired, or invalid.")

    try:
        session = await auth_service.exchange_code_for_session(
            code=code,
            code_verifier=code_verifier,
        )
    except AuthEmailNotAllowedError:
        return _build_blocked_auth_redirect_response(
            settings=settings,
            response_url=_build_login_redirect_url(settings, auth_error="email_not_allowed"),
        )

    with user_connection_scope(
        settings.database_url,
        user_id=session.identity.user_id,
    ) as connection:
        if not is_email_allowed(connection, email=session.identity.email):
            await _best_effort_revoke_refresh_token(auth_service, session.tokens.refresh_token)
            return _build_blocked_auth_redirect_response(
                settings=settings,
                response_url=_build_login_redirect_url(settings, auth_error="email_not_allowed"),
            )
        _bootstrap_user_session(connection, session)
        session_context = get_session_context(connection, session.identity.user_id)

    if session_context is None:
        raise AuthRequiredError("Authenticated user could not be resolved locally.")

    response = RedirectResponse(url=settings.frontend_app_url or "/", status_code=302)
    clear_oauth_code_verifier_cookie(response, settings)
    clear_oauth_state_cookie(response, settings)
    set_session_cookies(response, settings, session.tokens)
    ensure_csrf_cookie(response, settings, request.cookies.get(CSRF_COOKIE))
    return response


@router.post("/dev-login", response_model=SessionStatusResponse)
async def local_dev_login(
    request: Request,
    response: Response,
    settings: SettingsDep,
    auth_service: AuthServiceDep,
) -> SessionStatusResponse:
    if not settings.gust_dev_mode:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")

    auth_service.ensure_configured()
    try:
        session = await auth_service.sign_up_with_password(
            email=LOCAL_DEV_AUTH_EMAIL,
            password=LOCAL_DEV_AUTH_PASSWORD,
            display_name=LOCAL_DEV_AUTH_DISPLAY_NAME,
        )
    except UpstreamAuthError:
        session = await auth_service.sign_in_with_password(
            email=LOCAL_DEV_AUTH_EMAIL,
            password=LOCAL_DEV_AUTH_PASSWORD,
        )

    with user_connection_scope(
        settings.database_url,
        user_id=session.identity.user_id,
    ) as connection:
        if not is_email_allowed(connection, email=session.identity.email):
            await _best_effort_revoke_refresh_token(auth_service, session.tokens.refresh_token)
            raise AuthEmailNotAllowedError()
        _bootstrap_user_session(connection, session)
        session_context = get_session_context(connection, session.identity.user_id)

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
        try:
            await auth_service.revoke_refresh_token(refresh_token=refresh_token)
        except Exception:
            pass

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
    with user_connection_scope(
        settings.database_url,
        user_id=session_context.user.id,
    ) as connection:
        user = update_user_timezone(
            connection,
            user_id=session_context.user.id,
            timezone=payload.timezone,
        )
        if user is None:
            raise AuthRequiredError("Authenticated user could not be updated locally.")
        inbox = ensure_inbox_group(connection, user_id=session_context.user.id)

    csrf_token = ensure_csrf_cookie(response, settings, request.cookies.get(CSRF_COOKIE))
    return _build_session_status_response(
        SessionContext(
            user=user,
            inbox_group_id=inbox.id,
        ),
        csrf_token,
    )


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


def _build_login_redirect_url(settings: Settings, *, auth_error: str | None = None) -> str:
    frontend_app_url = (settings.frontend_app_url or "").rstrip("/")
    base_url = f"{frontend_app_url}/login" if frontend_app_url else "/login"

    if auth_error is None:
        return base_url

    return f"{base_url}?{urlencode({'auth_error': auth_error})}"


def _build_blocked_auth_redirect_response(
    *,
    settings: Settings,
    response_url: str,
) -> RedirectResponse:
    response = RedirectResponse(url=response_url, status_code=302)
    clear_oauth_code_verifier_cookie(response, settings)
    clear_oauth_state_cookie(response, settings)
    clear_session_cookies(response, settings)
    clear_csrf_cookie(response, settings)
    return response


async def _best_effort_revoke_refresh_token(
    auth_service: SupabaseAuthService,
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
