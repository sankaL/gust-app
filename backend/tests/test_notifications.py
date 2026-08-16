from __future__ import annotations

from dataclasses import dataclass

from fastapi import FastAPI
from starlette.testclient import TestClient

from app.core.dependencies import get_auth_service, get_pushover_service
from app.core.security import ACCESS_TOKEN_COOKIE
from app.db.engine import connection_scope
from app.db.repositories import get_notification_preferences, upsert_user
from app.services.auth import AuthenticatedIdentity

USER_ID = "11111111-1111-1111-1111-111111111111"
PUSHOVER_USER_KEY = "a" * 30


@dataclass
class FakeAuthService:
    def ensure_configured(self) -> None:
        return None

    def validate_access_token(
        self,
        access_token: str,
        *,
        allow_expired: bool = False,
    ) -> AuthenticatedIdentity:
        del allow_expired
        assert access_token == "access-token"
        return AuthenticatedIdentity(
            user_id=USER_ID,
            email="user@example.com",
            display_name="Gust User",
        )


class FakePushoverService:
    is_enabled = True

    async def validate_user_key(self, *, user_key: str) -> None:
        assert user_key == PUSHOVER_USER_KEY

    def encrypt_user_key(self, user_key: str) -> str:
        return f"encrypted:{user_key}"


def _authenticate(app: FastAPI, client: TestClient) -> None:
    app.dependency_overrides[get_auth_service] = lambda: FakeAuthService()
    app.dependency_overrides[get_pushover_service] = lambda: FakePushoverService()
    with connection_scope(client.app.state.settings.database_url) as connection:
        upsert_user(
            connection,
            user_id=USER_ID,
            email="user@example.com",
            display_name="Gust User",
            timezone="UTC",
        )
    client.cookies.set(ACCESS_TOKEN_COOKIE, "access-token")


def test_pushover_callback_persists_pushover_subscription_key(
    app: FastAPI,
    client: TestClient,
) -> None:
    _authenticate(app, client)
    client.cookies.set("gust_pushover_state", "state-token")

    response = client.get(
        "/settings/notifications/pushover/callback",
        params={
            "state": "state-token",
            "return_path": "/settings",
            "pushover_user_key": PUSHOVER_USER_KEY,
        },
    )

    assert response.status_code == 307
    assert response.headers["location"] == "http://frontend.test/settings?pushover=connected"
    with connection_scope(client.app.state.settings.database_url) as connection:
        preferences = get_notification_preferences(connection, user_id=USER_ID)
    assert preferences.pushover_user_key_encrypted == f"encrypted:{PUSHOVER_USER_KEY}"
    assert preferences.pushover_user_key_hint == "••••aaaa"


def test_pushover_callback_accepts_legacy_user_key_parameter(
    app: FastAPI,
    client: TestClient,
) -> None:
    _authenticate(app, client)
    client.cookies.set("gust_pushover_state", "state-token")

    response = client.get(
        "/settings/notifications/pushover/callback",
        params={
            "state": "state-token",
            "return_path": "/settings",
            "user": PUSHOVER_USER_KEY,
        },
    )

    assert response.status_code == 307
    with connection_scope(client.app.state.settings.database_url) as connection:
        preferences = get_notification_preferences(connection, user_id=USER_ID)
    assert preferences.pushover_user_key_encrypted == f"encrypted:{PUSHOVER_USER_KEY}"


def test_pushover_callback_rejects_missing_user_key(
    app: FastAPI,
    client: TestClient,
) -> None:
    _authenticate(app, client)
    client.cookies.set("gust_pushover_state", "state-token")

    response = client.get(
        "/settings/notifications/pushover/callback",
        params={"state": "state-token", "return_path": "/settings"},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "pushover_user_key_missing"


def test_pushover_callback_rejects_mismatched_state(
    app: FastAPI,
    client: TestClient,
) -> None:
    _authenticate(app, client)
    client.cookies.set("gust_pushover_state", "expected-state")

    response = client.get(
        "/settings/notifications/pushover/callback",
        params={
            "state": "attacker-state",
            "return_path": "/settings",
            "pushover_user_key": PUSHOVER_USER_KEY,
        },
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "pushover_state_invalid"
