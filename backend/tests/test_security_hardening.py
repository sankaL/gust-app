from __future__ import annotations

from dataclasses import dataclass

from fastapi import FastAPI

from app.core.dependencies import get_auth_service
from app.core.middleware import RequestContextMiddleware
from app.core.rate_limits import RequestRateLimiter
from app.core.security import (
    ACCESS_TOKEN_COOKIE,
    CSRF_COOKIE,
    OAUTH_CODE_VERIFIER_COOKIE,
    REFRESH_TOKEN_COOKIE,
    TokenBundle,
)
from app.db.engine import connection_scope
from app.db.repositories import ensure_inbox_group, upsert_user
from app.services.auth import AuthenticatedIdentity, AuthenticatedSession, ExpiredSignatureError


@dataclass
class FakeAuthService:
    def ensure_configured(self) -> None:
        return None

    def build_google_authorize_url(self, *, code_challenge: str, state: str) -> str:
        return f"https://supabase.example/auth?challenge={code_challenge}&state={state}"

    async def refresh_session(self, *, refresh_token: str) -> AuthenticatedSession:
        assert refresh_token == "refresh-token"
        return AuthenticatedSession(
            tokens=TokenBundle(
                access_token="fresh-access-token",
                refresh_token="refresh-token",
                expires_in=3600,
            ),
            identity=AuthenticatedIdentity(
                user_id="11111111-1111-1111-1111-111111111111",
                email="user@example.com",
                display_name="Gust User",
            ),
        )

    def validate_access_token(
        self,
        access_token: str,
        *,
        allow_expired: bool = False,
    ) -> AuthenticatedIdentity:
        if access_token == "expired-token" and not allow_expired:
            raise ExpiredSignatureError("expired")
        if access_token not in {"access-token", "fresh-access-token", "expired-token"}:
            raise AssertionError("unexpected token")
        return AuthenticatedIdentity(
            user_id="11111111-1111-1111-1111-111111111111",
            email="user@example.com",
            display_name="Gust User",
        )


def _override_auth_service(app: FastAPI) -> None:
    app.dependency_overrides[get_auth_service] = lambda: FakeAuthService()


def _request_context_middleware(app: FastAPI) -> RequestContextMiddleware:
    current = app.middleware_stack
    while current is not None:
        if isinstance(current, RequestContextMiddleware):
            return current
        current = getattr(current, "app", None)
    raise AssertionError("RequestContextMiddleware not found")


def test_public_get_rate_limit_returns_429(client) -> None:
    middleware = _request_context_middleware(client.app)
    client.app.state.settings.rate_limit_public_get_ip = "2/60"
    middleware.rate_limiter = RequestRateLimiter(client.app.state.settings)

    first = client.get("/health")
    second = client.get("/health")
    third = client.get("/health")

    assert first.status_code == 200
    assert second.status_code == 200
    assert third.status_code == 429
    assert third.json()["error"]["code"] == "rate_limit_exceeded"
    assert third.headers["Retry-After"]


def test_x_forwarded_for_does_not_bypass_public_get_limit(client) -> None:
    middleware = _request_context_middleware(client.app)
    client.app.state.settings.rate_limit_public_get_ip = "1/60"
    middleware.rate_limiter = RequestRateLimiter(client.app.state.settings)

    first = client.get("/health", headers={"X-Forwarded-For": "198.51.100.10"})
    second = client.get("/health", headers={"X-Forwarded-For": "203.0.113.25"})

    assert first.status_code == 200
    assert second.status_code == 429
    assert second.json()["error"]["code"] == "rate_limit_exceeded"


def test_auth_entry_rate_limit_returns_429(app: FastAPI, client) -> None:
    _override_auth_service(app)
    middleware = _request_context_middleware(app)
    middleware.auth_service = FakeAuthService()
    app.state.settings.rate_limit_auth_entry_ip = "1/60"
    middleware.rate_limiter = RequestRateLimiter(app.state.settings)

    first = client.get("/auth/session/google/start")
    second = client.get("/auth/session/google/start")

    assert first.status_code == 302
    assert OAUTH_CODE_VERIFIER_COOKIE in first.headers["set-cookie"]
    assert second.status_code == 429
    assert second.json()["error"]["code"] == "rate_limit_exceeded"


def test_authenticated_json_responses_set_no_store_headers(client) -> None:
    response = client.get("/auth/session")

    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"


def test_expired_access_token_counts_against_authenticated_write_limit(
    app: FastAPI,
    client,
) -> None:
    fake_auth_service = FakeAuthService()
    _override_auth_service(app)
    middleware = _request_context_middleware(app)
    middleware.auth_service = fake_auth_service
    app.state.settings.rate_limit_authenticated_write_user = "1/60"
    middleware.rate_limiter = RequestRateLimiter(app.state.settings)

    with connection_scope(client.app.state.settings.database_url) as connection:
        upsert_user(
            connection,
            user_id="11111111-1111-1111-1111-111111111111",
            email="user@example.com",
            display_name="Gust User",
            timezone="UTC",
        )
        ensure_inbox_group(connection, user_id="11111111-1111-1111-1111-111111111111")

    client.cookies.set(ACCESS_TOKEN_COOKIE, "expired-token")
    client.cookies.set(REFRESH_TOKEN_COOKIE, "refresh-token")
    client.cookies.set(CSRF_COOKIE, "csrf-token")
    headers = {"X-CSRF-Token": "csrf-token", "Origin": "http://frontend.test"}

    first = client.post("/groups", json={"name": "First"}, headers=headers)
    second = client.post("/groups", json={"name": "Second"}, headers=headers)

    assert first.status_code == 201
    assert second.status_code == 429
    assert second.json()["error"]["code"] == "rate_limit_exceeded"
