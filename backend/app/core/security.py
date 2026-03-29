from __future__ import annotations

# ruff: noqa: UP045
import base64
import hashlib
import secrets
from dataclasses import dataclass

from fastapi import Response

from app.core.settings import Settings

ACCESS_TOKEN_COOKIE = "gust_access_token"
REFRESH_TOKEN_COOKIE = "gust_refresh_token"
CSRF_COOKIE = "gust_csrf_token"
OAUTH_CODE_VERIFIER_COOKIE = "gust_oauth_code_verifier"
OAUTH_STATE_COOKIE = "gust_oauth_state"
CSRF_HEADER = "X-CSRF-Token"


@dataclass
class TokenBundle:
    access_token: str
    refresh_token: str
    expires_in: int


@dataclass
class PkceChallenge:
    verifier: str
    challenge: str


def generate_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def generate_oauth_state_token() -> str:
    return secrets.token_urlsafe(32)


def generate_pkce_challenge() -> PkceChallenge:
    verifier = secrets.token_urlsafe(64)
    challenge_bytes = hashlib.sha256(verifier.encode("utf-8")).digest()
    challenge = base64.urlsafe_b64encode(challenge_bytes).decode("utf-8").rstrip("=")
    return PkceChallenge(
        verifier=verifier,
        challenge=challenge,
    )


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


def set_oauth_code_verifier_cookie(
    response: Response,
    settings: Settings,
    pkce_challenge: PkceChallenge,
) -> None:
    cookie_kwargs = {
        "httponly": True,
        "secure": settings.session_cookie_secure,
        "samesite": "lax",
        "path": "/auth/session",
        "domain": settings.session_cookie_domain,
        "max_age": 600,
    }
    response.set_cookie(OAUTH_CODE_VERIFIER_COOKIE, pkce_challenge.verifier, **cookie_kwargs)


def clear_oauth_code_verifier_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        OAUTH_CODE_VERIFIER_COOKIE,
        path="/auth/session",
        domain=settings.session_cookie_domain,
        secure=settings.session_cookie_secure,
        httponly=True,
        samesite="lax",
    )


def set_oauth_state_cookie(
    response: Response,
    settings: Settings,
    state_token: str,
) -> None:
    response.set_cookie(
        OAUTH_STATE_COOKIE,
        state_token,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        path="/auth/session",
        domain=settings.session_cookie_domain,
        max_age=600,
    )


def clear_oauth_state_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        OAUTH_STATE_COOKIE,
        path="/auth/session",
        domain=settings.session_cookie_domain,
        secure=settings.session_cookie_secure,
        httponly=True,
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
