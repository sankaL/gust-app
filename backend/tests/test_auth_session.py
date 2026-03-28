from __future__ import annotations

# ruff: noqa: UP045
from dataclasses import dataclass

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.dependencies import get_auth_service
from app.core.errors import UpstreamAuthError
from app.core.security import (
    ACCESS_TOKEN_COOKIE,
    CSRF_COOKIE,
    OAUTH_CODE_VERIFIER_COOKIE,
    REFRESH_TOKEN_COOKIE,
    TokenBundle,
)
from app.db.engine import connection_scope
from app.db.repositories import get_session_context
from app.db.schema import allowed_users
from app.services.auth import (
    AuthenticatedIdentity,
    AuthenticatedSession,
    ExpiredSignatureError,
)


@dataclass
class FakeAuthService:
    fail_signup: bool = False

    def ensure_configured(self) -> None:
        return None

    def build_google_authorize_url(self, *, code_challenge: str) -> str:
        return (
            "https://supabase.example/auth/v1/authorize"
            f"?provider=google&code_challenge={code_challenge}"
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

    async def sign_up_with_password(
        self,
        *,
        email: str,
        password: str,
        display_name: str | None = None,
    ) -> AuthenticatedSession:
        assert email == "local-dev@gust.local"
        assert password == "gust-local-dev-password"
        assert display_name == "Local Dev User"
        if self.fail_signup:
            raise UpstreamAuthError("signup failed")
        return AuthenticatedSession(
            tokens=TokenBundle(
                access_token="access-token",
                refresh_token="refresh-token",
                expires_in=3600,
            ),
            identity=AuthenticatedIdentity(
                user_id="11111111-1111-1111-1111-111111111111",
                email=email,
                display_name=display_name,
            ),
        )

    async def sign_in_with_password(self, *, email: str, password: str) -> AuthenticatedSession:
        assert email == "local-dev@gust.local"
        assert password == "gust-local-dev-password"
        return AuthenticatedSession(
            tokens=TokenBundle(
                access_token="access-token",
                refresh_token="refresh-token",
                expires_in=3600,
            ),
            identity=AuthenticatedIdentity(
                user_id="11111111-1111-1111-1111-111111111111",
                email=email,
                display_name="Local Dev User",
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


def _allow_email(client: TestClient, email: str) -> None:
    with connection_scope(client.app.state.settings.database_url) as connection:
        normalized_email = email.strip().lower()
        exists = connection.execute(
            allowed_users.select().where(allowed_users.c.email == normalized_email)
        ).first()
        if exists is None:
            connection.execute(allowed_users.insert().values(email=normalized_email))


def _disallow_email(client: TestClient, email: str) -> None:
    with connection_scope(client.app.state.settings.database_url) as connection:
        connection.execute(
            allowed_users.delete().where(allowed_users.c.email == email.strip().lower())
        )


def test_get_session_returns_signed_out_without_cookies(client: TestClient) -> None:
    response = client.get("/auth/session", headers={"Origin": "http://frontend.test"})

    assert response.status_code == 200
    assert response.json() == {
        "signed_in": False,
        "user": None,
        "timezone": None,
        "inbox_group_id": None,
        "csrf_token": None,
    }
    assert response.headers["X-Request-ID"]
    assert response.headers["access-control-allow-origin"] == "http://frontend.test"
    assert response.headers["access-control-allow-credentials"] == "true"


def test_session_preflight_allows_frontend_origin(client: TestClient) -> None:
    response = client.options(
        "/auth/session/dev-login",
        headers={
            "Origin": "http://frontend.test",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://frontend.test"
    assert response.headers["access-control-allow-credentials"] == "true"
    assert "POST" in response.headers["access-control-allow-methods"]


def test_google_start_sets_pkce_cookies(app: FastAPI, client: TestClient) -> None:
    _override_auth_service(app, FakeAuthService())

    response = client.get("/auth/session/google/start")

    assert response.status_code == 302
    assert response.headers["location"].startswith("https://supabase.example/auth/v1/authorize")
    assert OAUTH_CODE_VERIFIER_COOKIE in response.headers["set-cookie"]


def test_callback_bootstraps_user_session_and_inbox(app: FastAPI, client: TestClient) -> None:
    _override_auth_service(app, FakeAuthService())
    _allow_email(client, "user@example.com")
    client.cookies.set(OAUTH_CODE_VERIFIER_COOKIE, "expected-verifier")

    response = client.get("/auth/session/callback?code=valid-code")

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


def test_local_dev_login_bootstraps_cookie_session(app: FastAPI, client: TestClient) -> None:
    app.state.settings.gust_dev_mode = True
    _override_auth_service(app, FakeAuthService())
    _allow_email(client, "local-dev@gust.local")

    response = client.post("/auth/session/dev-login")

    assert response.status_code == 200
    payload = response.json()
    assert payload["signed_in"] is True
    assert payload["user"]["email"] == "local-dev@gust.local"
    assert payload["csrf_token"] is not None
    assert ACCESS_TOKEN_COOKIE in response.headers["set-cookie"]
    assert REFRESH_TOKEN_COOKIE in response.headers["set-cookie"]


def test_local_dev_login_reuses_existing_local_account(app: FastAPI, client: TestClient) -> None:
    app.state.settings.gust_dev_mode = True
    service = FakeAuthService()
    service.fail_signup = True
    _override_auth_service(app, service)
    _allow_email(client, "local-dev@gust.local")

    response = client.post("/auth/session/dev-login")

    assert response.status_code == 200
    assert response.json()["user"]["email"] == "local-dev@gust.local"


def test_local_dev_login_is_hidden_outside_dev_mode(app: FastAPI, client: TestClient) -> None:
    _override_auth_service(app, FakeAuthService())

    response = client.post("/auth/session/dev-login")

    assert response.status_code == 404


def test_callback_preserves_existing_timezone(app: FastAPI, client: TestClient) -> None:
    _override_auth_service(app, FakeAuthService())
    _allow_email(client, "user@example.com")

    with connection_scope(client.app.state.settings.database_url) as connection:
        from app.db.repositories import upsert_user

        upsert_user(
            connection,
            user_id="11111111-1111-1111-1111-111111111111",
            email="user@example.com",
            display_name="Gust User",
            timezone="America/Toronto",
        )

    client.cookies.set(OAUTH_CODE_VERIFIER_COOKIE, "expected-verifier")

    response = client.get("/auth/session/callback?code=valid-code")

    assert response.status_code == 302

    with connection_scope(client.app.state.settings.database_url) as connection:
        context = get_session_context(connection, "11111111-1111-1111-1111-111111111111")

    assert context is not None
    assert context.user.timezone == "America/Toronto"


def test_timezone_update_requires_csrf(app: FastAPI, client: TestClient) -> None:
    _override_auth_service(app, FakeAuthService())
    _allow_email(client, "user@example.com")
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
    _allow_email(client, "user@example.com")
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
    _allow_email(client, "user@example.com")
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
    _allow_email(client, "user@example.com")
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
    _allow_email(client, "user@example.com")
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


def test_callback_redirects_blocked_email_to_login(app: FastAPI, client: TestClient) -> None:
    _override_auth_service(app, FakeAuthService())
    _disallow_email(client, "user@example.com")
    client.cookies.set(OAUTH_CODE_VERIFIER_COOKIE, "expected-verifier")

    response = client.get("/auth/session/callback?code=valid-code")

    assert response.status_code == 302
    assert response.headers["location"] == "http://frontend.test/login?auth_error=email_not_allowed"

    with connection_scope(client.app.state.settings.database_url) as connection:
        context = get_session_context(connection, "11111111-1111-1111-1111-111111111111")

    assert context is None


def test_session_refresh_rejects_existing_user_when_email_is_not_allowlisted(
    app: FastAPI,
    client: TestClient,
) -> None:
    _override_auth_service(app, FakeAuthService())
    _disallow_email(client, "user@example.com")
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

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "auth_email_not_allowed"
    assert ACCESS_TOKEN_COOKIE in response.headers["set-cookie"]
    assert REFRESH_TOKEN_COOKIE in response.headers["set-cookie"]
    assert CSRF_COOKIE in response.headers["set-cookie"]
