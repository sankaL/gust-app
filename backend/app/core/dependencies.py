from __future__ import annotations

# ruff: noqa: UP045
from typing import Annotated, Optional

from fastapi import Depends, Request, Response

from app.core.errors import AuthRequiredError, CsrfValidationError
from app.core.security import (
    ACCESS_TOKEN_COOKIE,
    CSRF_COOKIE,
    CSRF_HEADER,
    REFRESH_TOKEN_COOKIE,
    clear_csrf_cookie,
    clear_session_cookies,
    set_session_cookies,
)
from app.core.settings import Settings, get_settings
from app.db.engine import connection_scope
from app.db.repositories import SessionContext, get_session_context
from app.services.auth import (
    ExpiredSignatureError,
    InvalidTokenError,
    SupabaseAuthService,
)

SettingsDep = Annotated[Settings, Depends(get_settings)]


def get_auth_service(settings: SettingsDep) -> SupabaseAuthService:
    return SupabaseAuthService(settings)


async def get_optional_session_context(
    request: Request,
    response: Response,
    settings: SettingsDep,
    auth_service: Annotated[SupabaseAuthService, Depends(get_auth_service)],
) -> Optional[SessionContext]:
    access_token = request.cookies.get(ACCESS_TOKEN_COOKIE)
    refresh_token = request.cookies.get(REFRESH_TOKEN_COOKIE)

    if access_token:
        try:
            identity = auth_service.validate_access_token(access_token)
        except ExpiredSignatureError:
            if not refresh_token:
                clear_session_cookies(response, settings)
                clear_csrf_cookie(response, settings)
                return None

            try:
                refreshed_session = await auth_service.refresh_session(refresh_token=refresh_token)
                identity = refreshed_session.identity
                set_session_cookies(response, settings, refreshed_session.tokens)
            except Exception:
                clear_session_cookies(response, settings)
                clear_csrf_cookie(response, settings)
                return None
        except InvalidTokenError:
            clear_session_cookies(response, settings)
            clear_csrf_cookie(response, settings)
            return None
    elif refresh_token:
        try:
            refreshed_session = await auth_service.refresh_session(refresh_token=refresh_token)
            identity = refreshed_session.identity
            set_session_cookies(response, settings, refreshed_session.tokens)
        except Exception:
            clear_session_cookies(response, settings)
            clear_csrf_cookie(response, settings)
            return None
    else:
        return None

    with connection_scope(settings.database_url) as connection:
        return get_session_context(connection, identity.user_id)


async def get_current_session_context(
    session_context: Annotated[Optional[SessionContext], Depends(get_optional_session_context)],
) -> SessionContext:
    if session_context is None:
        raise AuthRequiredError()
    return session_context


def require_csrf(
    request: Request,
    session_context: Annotated[SessionContext, Depends(get_current_session_context)],
) -> SessionContext:
    cookie_token = request.cookies.get(CSRF_COOKIE)
    header_token = request.headers.get(CSRF_HEADER)

    if not cookie_token or not header_token or cookie_token != header_token:
        raise CsrfValidationError()

    return session_context
