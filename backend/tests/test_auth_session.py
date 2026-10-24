from __future__ import annotations

import asyncio
from dataclasses import dataclass

from fastapi import FastAPI
from starlette.testclient import TestClient

from app.core.dependencies import get_auth_service
from app.core.errors import InvalidCredentialsError
from app.core.security import (
    ACCESS_TOKEN_COOKIE,
    CSRF_COOKIE,
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
    LocalDevAuthService,
)

VALID_EMAIL = "user@example.com"
VALID_PASSWORD = "correct-horse-battery-staple"
FRONTEND_ORIGIN = {"Origin": "http://frontend.test"}


@dataclass
class FakeAuthService:
    sign_in_calls: int = 0

    def ensure_configured(self) -> None:
        return None

    async def sign_in_with_password(self, *, email: str, password: str) -> AuthenticatedSession:
        self.sign_in_calls += 1
        if email != VALID_EMAIL or password != VALID_PASSWORD:
            raise InvalidCredentialsError()
        return AuthenticatedSession(
            tokens=TokenBundle(
                access_token="access-token",
                refresh_token="refresh-token",
                expires_in=3600,
            ),
            identity=AuthenticatedIdentity(
                user_id="11111111-1111-1111-1111-111111111111",
                email=email,
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

    def validate_access_token(
        self,
        access_token: str,
        *,
        allow_expired: bool = False,
    ) -> AuthenticatedIdentity:
        if access_token == "expired-token" and not allow_expired:
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


def _assert_cookie_cleared(response, cookie_name: str) -> None:
    matching_headers = [
        header
        for header in response.headers.get_list("set-cookie")
        if header.startswith(f"{cookie_name}=")
    ]
    assert matching_headers, f"Missing Set-Cookie clearing header for {cookie_name}"
    assert all("Max-Age=0" in header for header in matching_headers)


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


def test_password_login_bootstraps_user_session_and_inbox(
    app: FastAPI,
    client: TestClient,
) -> None:
    _override_auth_service(app, FakeAuthService())
    _allow_email(client, "user@example.com")

    response = client.post(
        "/auth/session/login",
        json={"email": VALID_EMAIL, "password": VALID_PASSWORD},
        headers=FRONTEND_ORIGIN,
    )

    assert response.status_code == 200
    login_payload = response.json()
    assert login_payload["signed_in"] is True
    assert login_payload["user"]["email"] == "user@example.com"
    assert login_payload["csrf_token"] is not None
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
    assert payload["csrf_token"] == login_payload["csrf_token"]

    with connection_scope(client.app.state.settings.database_url) as connection:
        context = get_session_context(connection, "11111111-1111-1111-1111-111111111111")
    assert context is not None
    assert context.user.email == "user@example.com"
    assert context.inbox_group_id == payload["inbox_group_id"]


def test_password_login_normalizes_email_before_sign_in(
    app: FastAPI,
    client: TestClient,
) -> None:
    _override_auth_service(app, FakeAuthService())
    _allow_email(client, "user@example.com")

    response = client.post(
        "/auth/session/login",
        json={"email": "  User@Example.com ", "password": VALID_PASSWORD},
        headers=FRONTEND_ORIGIN,
    )

    assert response.status_code == 200
    assert response.json()["user"]["email"] == "user@example.com"


def test_password_login_rejects_wrong_password_without_session(
    app: FastAPI,
    client: TestClient,
) -> None:
    _override_auth_service(app, FakeAuthService())
    _allow_email(client, "user@example.com")

    response = client.post(
        "/auth/session/login",
        json={"email": VALID_EMAIL, "password": "wrong-password"},
        headers=FRONTEND_ORIGIN,
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "auth_invalid_credentials"
    set_cookie_headers = response.headers.get_list("set-cookie")
    assert not any(header.startswith(f"{ACCESS_TOKEN_COOKIE}=") for header in set_cookie_headers)
    assert not any(header.startswith(f"{REFRESH_TOKEN_COOKIE}=") for header in set_cookie_headers)


def test_password_login_rejects_foreign_origin_before_contacting_provider(
    app: FastAPI,
    client: TestClient,
) -> None:
    fake_service = FakeAuthService()
    _override_auth_service(app, fake_service)
    _allow_email(client, "user@example.com")

    response = client.post(
        "/auth/session/login",
        json={"email": VALID_EMAIL, "password": VALID_PASSWORD},
        headers={"Origin": "https://evil.test"},
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "origin_invalid"
    assert fake_service.sign_in_calls == 0


def test_password_login_rejects_missing_origin(app: FastAPI, client: TestClient) -> None:
    fake_service = FakeAuthService()
    _override_auth_service(app, fake_service)

    response = client.post(
        "/auth/session/login",
        json={"email": VALID_EMAIL, "password": VALID_PASSWORD},
        headers={},
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "origin_invalid"
    assert fake_service.sign_in_calls == 0


def test_password_login_rejects_malformed_email(app: FastAPI, client: TestClient) -> None:
    fake_service = FakeAuthService()
    _override_auth_service(app, fake_service)

    response = client.post(
        "/auth/session/login",
        json={"email": "not-an-email", "password": VALID_PASSWORD},
        headers=FRONTEND_ORIGIN,
    )

    assert response.status_code == 422
    assert fake_service.sign_in_calls == 0


def test_password_login_is_hidden_in_dev_mode(app: FastAPI, client: TestClient) -> None:
    app.state.settings.gust_dev_mode = True
    _override_auth_service(app, FakeAuthService())

    response = client.post(
        "/auth/session/login",
        json={"email": VALID_EMAIL, "password": VALID_PASSWORD},
        headers=FRONTEND_ORIGIN,
    )

    assert response.status_code == 404


def test_local_dev_login_bootstraps_cookie_session(app: FastAPI, client: TestClient) -> None:
    app.state.settings.gust_dev_mode = True
    app.state.settings.local_dev_auth_secret = (
        "test-local-dev-secret-that-is-at-least-32-characters"
    )
    service = LocalDevAuthService(app.state.settings)
    _override_auth_service(app, service)
    _allow_email(client, "local-dev@gust.local")

    response = client.post("/auth/session/dev-login")

    assert response.status_code == 200
    payload = response.json()
    assert payload["signed_in"] is True
    assert payload["user"]["email"] == "local-dev@gust.local"
    assert payload["csrf_token"] is not None
    assert ACCESS_TOKEN_COOKIE in response.headers["set-cookie"]
    assert REFRESH_TOKEN_COOKIE in response.headers["set-cookie"]

    session = service.create_dev_session()
    identity = service.validate_access_token(session.tokens.access_token)
    refreshed = asyncio.run(service.refresh_session(refresh_token=session.tokens.refresh_token))
    assert identity.user_id == LocalDevAuthService.USER_ID
    assert refreshed.identity.email == "local-dev@gust.local"


def test_local_dev_login_is_hidden_outside_dev_mode(app: FastAPI, client: TestClient) -> None:
    app.state.settings.gust_dev_mode = False
    _override_auth_service(app, FakeAuthService())

    response = client.post("/auth/session/dev-login")

    assert response.status_code == 404


def test_password_login_preserves_existing_timezone(app: FastAPI, client: TestClient) -> None:
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

    response = client.post(
        "/auth/session/login",
        json={"email": VALID_EMAIL, "password": VALID_PASSWORD},
        headers=FRONTEND_ORIGIN,
    )

    assert response.status_code == 200

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
        headers={"X-CSRF-Token": csrf_token, "Origin": "http://frontend.test"},
    )

    assert response.status_code == 200
    assert response.json()["timezone"] == "America/Toronto"


def test_timezone_update_rejects_foreign_origin(app: FastAPI, client: TestClient) -> None:
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

    csrf_token = client.get("/auth/session").json()["csrf_token"]
    response = client.put(
        "/auth/session/timezone",
        json={"timezone": "America/Toronto"},
        headers={"X-CSRF-Token": csrf_token, "Origin": "https://evil.test"},
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "origin_invalid"


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
    response = client.post(
        "/auth/session/logout",
        headers={"X-CSRF-Token": csrf_token, "Origin": "http://frontend.test"},
    )

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


def test_password_login_blocks_email_outside_allowlist(app: FastAPI, client: TestClient) -> None:
    fake_service = FakeAuthService()
    _override_auth_service(app, fake_service)
    _disallow_email(client, "user@example.com")

    response = client.post(
        "/auth/session/login",
        json={"email": VALID_EMAIL, "password": VALID_PASSWORD},
        headers=FRONTEND_ORIGIN,
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "auth_email_not_allowed"
    _assert_cookie_cleared(response, ACCESS_TOKEN_COOKIE)
    _assert_cookie_cleared(response, REFRESH_TOKEN_COOKIE)
    _assert_cookie_cleared(response, CSRF_COOKIE)
    assert fake_service.revoked_token == "refresh-token"

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
