from __future__ import annotations

from dataclasses import dataclass

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.dependencies import get_auth_service
from app.core.security import (
    ACCESS_TOKEN_COOKIE,
    CSRF_COOKIE,
    OAUTH_CODE_VERIFIER_COOKIE,
    OAUTH_STATE_COOKIE,
    REFRESH_TOKEN_COOKIE,
    TokenBundle,
)
from app.db.engine import connection_scope
from app.db.repositories import get_session_context
from app.services.auth import (
    AuthenticatedIdentity,
    AuthenticatedSession,
    ExpiredSignatureError,
)


@dataclass
class FakeAuthService:
    def ensure_configured(self) -> None:
        return None

    def build_google_authorize_url(self, *, state: str, code_challenge: str) -> str:
        return (
            "https://supabase.example/auth/v1/authorize"
            f"?provider=google&state={state}&code_challenge={code_challenge}"
        )

    async def exchange_code_for_session(
        self,
        *,
        code: str,
        code_verifier: str,
    ) -> AuthenticatedSession:
        assert code == "valid-code"
        assert code_verifier == "expected-verifier"
        return AuthenticatedSession(
            tokens=TokenBundle(
                access_token="access-token",
                refresh_token="refresh-token",
                expires_in=3600,
            ),
            identity=AuthenticatedIdentity(
                user_id="11111111-1111-1111-1111-111111111111",
                email="user@example.com",
                display_name="Gust User",
            ),
        )

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

    async def revoke_refresh_token(self, *, refresh_token: str) -> None:
        self.revoked_token = refresh_token

    def validate_access_token(self, access_token: str) -> AuthenticatedIdentity:
        if access_token == "expired-token":
            raise ExpiredSignatureError("expired")
        if access_token not in {"access-token", "fresh-access-token"}:
            raise AssertionError("unexpected token")
        return AuthenticatedIdentity(
            user_id="11111111-1111-1111-1111-111111111111",
            email="user@example.com",
            display_name="Gust User",
        )


def _override_auth_service(app: FastAPI, service: FakeAuthService) -> None:
    app.dependency_overrides[get_auth_service] = lambda: service


def test_get_session_returns_signed_out_without_cookies(client: TestClient) -> None:
    response = client.get("/auth/session")

    assert response.status_code == 200
    assert response.json() == {
        "signed_in": False,
        "user": None,
        "timezone": None,
        "inbox_group_id": None,
        "csrf_token": None,
    }
    assert response.headers["X-Request-ID"]


def test_google_start_sets_pkce_cookies(app: FastAPI, client: TestClient) -> None:
    _override_auth_service(app, FakeAuthService())

    response = client.get("/auth/session/google/start")

    assert response.status_code == 302
    assert response.headers["location"].startswith("https://supabase.example/auth/v1/authorize")
    assert OAUTH_STATE_COOKIE in response.headers["set-cookie"]
    assert OAUTH_CODE_VERIFIER_COOKIE in response.headers["set-cookie"]


def test_callback_bootstraps_user_session_and_inbox(app: FastAPI, client: TestClient) -> None:
    _override_auth_service(app, FakeAuthService())
    client.cookies.set(OAUTH_STATE_COOKIE, "expected-state")
    client.cookies.set(OAUTH_CODE_VERIFIER_COOKIE, "expected-verifier")

    response = client.get("/auth/session/callback?code=valid-code&state=expected-state")

    assert response.status_code == 302
    assert response.headers["location"] == "http://frontend.test"
    assert ACCESS_TOKEN_COOKIE in response.headers["set-cookie"]
    assert REFRESH_TOKEN_COOKIE in response.headers["set-cookie"]
    assert CSRF_COOKIE in response.headers["set-cookie"]

    session_response = client.get("/auth/session")
    assert session_response.status_code == 200
    payload = session_response.json()
    assert payload["signed_in"] is True
    assert payload["user"]["email"] == "user@example.com"
    assert payload["timezone"] == "UTC"
    assert payload["inbox_group_id"] is not None
    assert payload["csrf_token"] is not None

    with connection_scope(client.app.state.settings.database_url) as connection:
        context = get_session_context(connection, "11111111-1111-1111-1111-111111111111")
    assert context is not None
    assert context.user.email == "user@example.com"
    assert context.inbox_group_id == payload["inbox_group_id"]


def test_callback_preserves_existing_timezone(app: FastAPI, client: TestClient) -> None:
    _override_auth_service(app, FakeAuthService())

    with connection_scope(client.app.state.settings.database_url) as connection:
        from app.db.repositories import upsert_user

        upsert_user(
            connection,
            user_id="11111111-1111-1111-1111-111111111111",
            email="user@example.com",
            display_name="Gust User",
            timezone="America/Toronto",
        )

    client.cookies.set(OAUTH_STATE_COOKIE, "expected-state")
    client.cookies.set(OAUTH_CODE_VERIFIER_COOKIE, "expected-verifier")

    response = client.get("/auth/session/callback?code=valid-code&state=expected-state")

    assert response.status_code == 302

    with connection_scope(client.app.state.settings.database_url) as connection:
        context = get_session_context(connection, "11111111-1111-1111-1111-111111111111")

    assert context is not None
    assert context.user.timezone == "America/Toronto"


def test_timezone_update_requires_csrf(app: FastAPI, client: TestClient) -> None:
    _override_auth_service(app, FakeAuthService())
    client.cookies.set(ACCESS_TOKEN_COOKIE, "access-token")
    client.cookies.set(REFRESH_TOKEN_COOKIE, "refresh-token")

    with connection_scope(client.app.state.settings.database_url) as connection:
        from app.db.repositories import ensure_inbox_group, upsert_user

        upsert_user(
            connection,
            user_id="11111111-1111-1111-1111-111111111111",
            email="user@example.com",
            display_name="Gust User",
            timezone="UTC",
        )
        ensure_inbox_group(connection, user_id="11111111-1111-1111-1111-111111111111")

    response = client.put("/auth/session/timezone", json={"timezone": "America/Toronto"})

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "csrf_invalid"


def test_timezone_update_persists_valid_timezone(app: FastAPI, client: TestClient) -> None:
    _override_auth_service(app, FakeAuthService())
    client.cookies.set(ACCESS_TOKEN_COOKIE, "access-token")
    client.cookies.set(REFRESH_TOKEN_COOKIE, "refresh-token")

    with connection_scope(client.app.state.settings.database_url) as connection:
        from app.db.repositories import ensure_inbox_group, upsert_user

        upsert_user(
            connection,
            user_id="11111111-1111-1111-1111-111111111111",
            email="user@example.com",
            display_name="Gust User",
            timezone="UTC",
        )
        ensure_inbox_group(connection, user_id="11111111-1111-1111-1111-111111111111")

    session_response = client.get("/auth/session")
    csrf_token = session_response.json()["csrf_token"]

    response = client.put(
        "/auth/session/timezone",
        json={"timezone": "America/Toronto"},
        headers={"X-CSRF-Token": csrf_token},
    )

    assert response.status_code == 200
    assert response.json()["timezone"] == "America/Toronto"


def test_logout_clears_cookies_and_revokes_refresh_token(app: FastAPI, client: TestClient) -> None:
    fake_service = FakeAuthService()
    _override_auth_service(app, fake_service)
    client.cookies.set(ACCESS_TOKEN_COOKIE, "access-token")
    client.cookies.set(REFRESH_TOKEN_COOKIE, "refresh-token")

    with connection_scope(client.app.state.settings.database_url) as connection:
        from app.db.repositories import ensure_inbox_group, upsert_user

        upsert_user(
            connection,
            user_id="11111111-1111-1111-1111-111111111111",
            email="user@example.com",
            display_name="Gust User",
            timezone="UTC",
        )
        ensure_inbox_group(connection, user_id="11111111-1111-1111-1111-111111111111")

    csrf_token = client.get("/auth/session").json()["csrf_token"]
    response = client.post("/auth/session/logout", headers={"X-CSRF-Token": csrf_token})

    assert response.status_code == 200
    assert response.json() == {"signed_out": True}
    assert fake_service.revoked_token == "refresh-token"


def test_expired_access_token_is_refreshed(app: FastAPI, client: TestClient) -> None:
    _override_auth_service(app, FakeAuthService())
    client.cookies.set(ACCESS_TOKEN_COOKIE, "expired-token")
    client.cookies.set(REFRESH_TOKEN_COOKIE, "refresh-token")

    with connection_scope(client.app.state.settings.database_url) as connection:
        from app.db.repositories import ensure_inbox_group, upsert_user

        upsert_user(
            connection,
            user_id="11111111-1111-1111-1111-111111111111",
            email="user@example.com",
            display_name="Gust User",
            timezone="UTC",
        )
        ensure_inbox_group(connection, user_id="11111111-1111-1111-1111-111111111111")

    response = client.get("/auth/session")

    assert response.status_code == 200
    assert response.json()["signed_in"] is True
    assert ACCESS_TOKEN_COOKIE in response.headers["set-cookie"]


def test_refresh_token_restores_session_when_access_cookie_has_expired(
    app: FastAPI,
    client: TestClient,
) -> None:
    _override_auth_service(app, FakeAuthService())
    client.cookies.set(REFRESH_TOKEN_COOKIE, "refresh-token")

    with connection_scope(client.app.state.settings.database_url) as connection:
        from app.db.repositories import ensure_inbox_group, upsert_user

        upsert_user(
            connection,
            user_id="11111111-1111-1111-1111-111111111111",
            email="user@example.com",
            display_name="Gust User",
            timezone="UTC",
        )
        ensure_inbox_group(connection, user_id="11111111-1111-1111-1111-111111111111")

    response = client.get("/auth/session")

    assert response.status_code == 200
    assert response.json()["signed_in"] is True
    assert ACCESS_TOKEN_COOKIE in response.headers["set-cookie"]
