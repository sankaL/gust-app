from __future__ import annotations

import secrets
from dataclasses import dataclass

from fastapi import Response

from app.core.settings import Settings

ACCESS_TOKEN_COOKIE = "gust_access_token"
REFRESH_TOKEN_COOKIE = "gust_refresh_token"
CSRF_COOKIE = "gust_csrf_token"
CSRF_HEADER = "X-CSRF-Token"


@dataclass
class TokenBundle:
    access_token: str
    refresh_token: str
    expires_in: int


def generate_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def set_session_cookies(
    response: Response,
    settings: Settings,
    tokens: TokenBundle,
) -> None:
    cookie_kwargs = {
        "httponly": True,
        "secure": settings.session_cookie_secure,
        "samesite": "lax",
        "path": "/",
        "domain": settings.session_cookie_domain,
    }
    response.set_cookie(
        ACCESS_TOKEN_COOKIE,
        tokens.access_token,
        max_age=tokens.expires_in,
        **cookie_kwargs,
    )
    response.set_cookie(
        REFRESH_TOKEN_COOKIE,
        tokens.refresh_token,
        max_age=60 * 60 * 24 * 30,
        **cookie_kwargs,
    )


def clear_session_cookies(response: Response, settings: Settings) -> None:
    for cookie_name in (ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE):
        response.delete_cookie(
            cookie_name,
            path="/",
            domain=settings.session_cookie_domain,
            secure=settings.session_cookie_secure,
            httponly=True,
            samesite="lax",
        )


def set_csrf_cookie(response: Response, settings: Settings, token: str) -> None:
    response.set_cookie(
        CSRF_COOKIE,
        token,
        httponly=False,
        secure=settings.session_cookie_secure,
        samesite="lax",
        path="/",
        domain=settings.session_cookie_domain,
        max_age=60 * 60 * 24 * 30,
    )


def clear_csrf_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        CSRF_COOKIE,
        path="/",
        domain=settings.session_cookie_domain,
        secure=settings.session_cookie_secure,
        httponly=False,
        samesite="lax",
    )


def ensure_csrf_cookie(
    response: Response,
    settings: Settings,
    existing_token: str | None,
) -> str:
    token = existing_token or generate_csrf_token()
    if token != existing_token:
        set_csrf_cookie(response, settings, token)
    return token
