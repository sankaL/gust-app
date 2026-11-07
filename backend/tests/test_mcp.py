from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

import anyio
import httpx2
import pytest
import sqlalchemy as sa
from fastapi import FastAPI
from mcp.client.session import ClientSession
from mcp.client.streamable_http import streamable_http_client
from pydantic import ValidationError
from starlette.testclient import TestClient

from app.core.dependencies import get_auth_service
from app.core.security import ACCESS_TOKEN_COOKIE
from app.core.settings import Settings
from app.db.engine import connection_scope
from app.db.repositories import ensure_inbox_group, upsert_user
from app.db.schema import (
    allowed_users,
    groups,
    mcp_access_tokens,
    mcp_audit_events,
    subtasks,
    tasks,
)
from app.services.agent_access import AgentAccessService, hash_token
from app.services.agent_operations import AgentOperations
from app.services.auth import AuthenticatedIdentity

USER_ID = "11111111-1111-1111-1111-111111111111"
OTHER_USER_ID = "22222222-2222-2222-2222-222222222222"
MCP_ENV = {"MCP_SERVER_ENABLED": "true", "MCP_PUBLIC_URL": "http://testserver/mcp"}
MCP_HEADERS = {
    "Accept": "application/json, text/event-stream",
    "Content-Type": "application/json",
    "MCP-Protocol-Version": "2025-11-25",
}
ALL_TOOLS = {
    "get_context",
    "list_groups",
    "list_tasks",
    "get_task",
    "create_task",
    "create_tasks",
    "update_task",
    "complete_task",
    "reopen_task",
    "restore_task",
    "add_subtask",
    "update_subtask",
    "create_group",
    "update_group",
    "delete_task",
    "delete_subtask",
    "delete_group",
}


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


# ----- helpers ---------------------------------------------------------------------------


def _db(app: FastAPI) -> str:
    return app.state.settings.database_url


def _seed_user(
    app: FastAPI,
    *,
    user_id: str = USER_ID,
    email: str = "user@example.com",
    timezone_name: str = "UTC",
) -> str:
    with connection_scope(_db(app)) as connection:
        upsert_user(
            connection,
            user_id=user_id,
            email=email,
            display_name="Gust User",
            timezone=timezone_name,
        )
        return ensure_inbox_group(connection, user_id=user_id).id


def _seed_group(app: FastAPI, *, user_id: str, name: str) -> str:
    group_id = str(uuid.uuid4())
    with connection_scope(_db(app)) as connection:
        connection.execute(
            groups.insert().values(
                id=group_id,
                user_id=user_id,
                name=name,
                description=None,
                is_system=False,
                system_key=None,
            )
        )
    return group_id


def _seed_task(
    app: FastAPI,
    *,
    user_id: str,
    group_id: str,
    title: str,
    description: str | None = None,
    due: date | None = None,
    reminder_at: datetime | None = None,
    status: str = "open",
    recurrence_frequency: str | None = None,
    created_at: datetime | None = None,
) -> str:
    task_id = str(uuid.uuid4())
    extra = {"created_at": created_at} if created_at is not None else {}
    with connection_scope(_db(app)) as connection:
        connection.execute(
            tasks.insert().values(
                **extra,
                id=task_id,
                user_id=user_id,
                group_id=group_id,
                title=title,
                description=description,
                status=status,
                needs_review=False,
                due_date=due,
                reminder_at=reminder_at,
                recurrence_frequency=recurrence_frequency,
                recurrence_interval=1 if recurrence_frequency else None,
                completed_at=datetime.now(UTC) if status == "completed" else None,
            )
        )
    return task_id


def _make_token(
    app: FastAPI,
    *,
    user_id: str = USER_ID,
    access_level: str = "read_write",
) -> str:
    service = AgentAccessService(settings=app.state.settings)
    service.set_enabled(user_id=user_id, enabled=True)
    return service.create_token(
        user_id=user_id,
        name="Muse",
        access_level=access_level,
        expires_in_days=30,
    ).plaintext


def _rpc(
    client: TestClient,
    token: str | None,
    method: str,
    params: dict | None = None,
    *,
    headers: dict[str, str] | None = None,
):
    request_headers = dict(MCP_HEADERS)
    if token is not None:
        request_headers["Authorization"] = f"Bearer {token}"
    request_headers.update(headers or {})
    return client.post(
        "/mcp",
        json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}},
        headers=request_headers,
    )


def _call(client: TestClient, token: str, name: str, arguments: dict | None = None) -> dict:
    response = _rpc(client, token, "tools/call", {"name": name, "arguments": arguments or {}})
    assert response.status_code == 200, response.text
    body = response.json()
    assert "result" in body, body
    return body["result"]


def _ok(client: TestClient, token: str, name: str, arguments: dict | None = None) -> dict:
    result = _call(client, token, name, arguments)
    assert result["isError"] is False, result["content"]
    return result["structuredContent"]


def _error_text(client: TestClient, token: str, name: str, arguments: dict | None = None) -> str:
    result = _call(client, token, name, arguments)
    assert result["isError"] is True, result
    return result["content"][0]["text"]


def _audit_rows(app: FastAPI) -> list[sa.Row]:
    with connection_scope(_db(app)) as connection:
        return connection.execute(
            sa.select(mcp_audit_events).order_by(mcp_audit_events.c.created_at)
        ).fetchall()


def _settings_headers(app: FastAPI, client: TestClient) -> dict[str, str]:
    app.dependency_overrides[get_auth_service] = lambda: FakeAuthService()
    _seed_user(app)
    client.cookies.set(ACCESS_TOKEN_COOKIE, "access-token")
    csrf_token = client.get("/auth/session").json()["csrf_token"]
    return {"X-CSRF-Token": csrf_token, "Origin": "http://frontend.test"}


@pytest.fixture()
def mcp_app(app_factory) -> FastAPI:
    return app_factory(MCP_ENV)


@pytest.fixture()
def mcp_client(mcp_app: FastAPI):
    with TestClient(mcp_app, follow_redirects=False) as test_client:
        yield test_client


# ----- server flag -----------------------------------------------------------------------


def test_mcp_is_not_mounted_and_settings_unavailable_when_flag_is_off(
    app: FastAPI,
    client: TestClient,
) -> None:
    headers = _settings_headers(app, client)

    overview = client.get("/settings/agent-access")
    assert overview.status_code == 200
    assert overview.json()["available"] is False
    assert overview.json()["endpoint_url"] is None

    enable = client.put("/settings/agent-access", json={"enabled": True}, headers=headers)
    assert enable.status_code == 409
    assert enable.json()["error"]["code"] == "agent_access_unavailable"

    response = client.post("/mcp", json={}, headers=MCP_HEADERS)
    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}


def test_unknown_paths_keep_the_gust_error_envelope_when_mcp_is_mounted(
    mcp_client: TestClient,
) -> None:
    # The same JSON 404 the app returns without MCP, not the MCP app's plain-text one.
    response = mcp_client.get("/does-not-exist")
    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}
    assert mcp_client.get("/health").status_code == 200


def test_settings_requires_https_mcp_url_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("MCP_PUBLIC_URL", "BACKEND_PUBLIC_URL", "GUST_DEV_MODE"):
        monkeypatch.delenv(name, raising=False)
    base = {"APP_ENV": "production", "DATABASE_URL": "sqlite://", "MCP_SERVER_ENABLED": True}
    with pytest.raises(ValidationError, match="MCP_PUBLIC_URL is required"):
        Settings(**base)
    with pytest.raises(ValidationError, match="https"):
        Settings(**base, MCP_PUBLIC_URL="http://api.gustapp.ca/mcp")
    with pytest.raises(ValidationError, match="/mcp endpoint"):
        Settings(**base, MCP_PUBLIC_URL="https://api.gustapp.ca/other")
    settings = Settings(**base, MCP_PUBLIC_URL="https://api.gustapp.ca/mcp")
    assert settings.resolved_mcp_public_url == "https://api.gustapp.ca/mcp"
    assert Settings(APP_ENV="production", DATABASE_URL="sqlite://").mcp_server_enabled is False


# ----- Settings routes -------------------------------------------------------------------


def test_agent_access_writes_require_csrf(mcp_app: FastAPI, mcp_client: TestClient) -> None:
    _settings_headers(mcp_app, mcp_client)
    response = mcp_client.put("/settings/agent-access", json={"enabled": True})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "csrf_invalid"


def test_token_lifecycle_through_settings(mcp_app: FastAPI, mcp_client: TestClient) -> None:
    headers = _settings_headers(mcp_app, mcp_client)

    overview = mcp_client.get("/settings/agent-access").json()
    assert overview["available"] is True
    assert overview["enabled"] is False
    assert overview["endpoint_url"] == "http://testserver/mcp"

    blocked = mcp_client.post(
        "/settings/agent-access/tokens",
        json={"name": "Muse", "access_level": "read", "expires_in_days": 30},
        headers=headers,
    )
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "agent_access_disabled"

    enabled = mcp_client.put("/settings/agent-access", json={"enabled": True}, headers=headers)
    assert enabled.json()["enabled"] is True

    created = mcp_client.post(
        "/settings/agent-access/tokens",
        json={"name": "  Muse  ", "access_level": "read", "expires_in_days": 90},
        headers=headers,
    )
    assert created.status_code == 201
    assert created.headers["cache-control"] == "no-store"
    body = created.json()
    secret = body["secret"]
    assert secret.startswith("gust_mcp_") and len(secret) == len("gust_mcp_") + 43
    assert body["token"]["name"] == "Muse"
    assert secret.startswith(body["token"]["token_prefix"])

    listed = mcp_client.get("/settings/agent-access").json()
    assert [token["id"] for token in listed["tokens"]] == [body["token"]["id"]]
    assert secret not in str(listed)
    with connection_scope(_db(mcp_app)) as connection:
        stored_hash = connection.execute(sa.select(mcp_access_tokens.c.token_hash)).scalar_one()
    assert stored_hash == hash_token(secret)

    revoked = mcp_client.delete(
        f"/settings/agent-access/tokens/{body['token']['id']}",
        headers=headers,
    )
    assert revoked.status_code == 204
    assert mcp_client.get("/settings/agent-access").json()["tokens"] == []
    assert _rpc(mcp_client, secret, "tools/list").status_code == 401

    missing = mcp_client.delete("/settings/agent-access/tokens/not-a-uuid", headers=headers)
    assert missing.status_code == 404


def test_cannot_revoke_another_users_token(mcp_app: FastAPI, mcp_client: TestClient) -> None:
    headers = _settings_headers(mcp_app, mcp_client)
    _seed_user(mcp_app, user_id=OTHER_USER_ID, email="other@example.com")
    _make_token(mcp_app, user_id=OTHER_USER_ID)
    with connection_scope(_db(mcp_app)) as connection:
        other_token_id = connection.execute(
            sa.select(mcp_access_tokens.c.id).where(mcp_access_tokens.c.user_id == OTHER_USER_ID)
        ).scalar_one()

    response = mcp_client.delete(f"/settings/agent-access/tokens/{other_token_id}", headers=headers)

    assert response.status_code == 404
    with connection_scope(_db(mcp_app)) as connection:
        revoked_at = connection.execute(
            sa.select(mcp_access_tokens.c.revoked_at).where(
                mcp_access_tokens.c.id == other_token_id
            )
        ).scalar_one()
    assert revoked_at is None


def test_token_request_validation_and_cap(mcp_app: FastAPI, mcp_client: TestClient) -> None:
    headers = _settings_headers(mcp_app, mcp_client)
    mcp_client.put("/settings/agent-access", json={"enabled": True}, headers=headers)

    bad_expiry = mcp_client.post(
        "/settings/agent-access/tokens",
        json={"name": "Muse", "access_level": "read", "expires_in_days": 3650},
        headers=headers,
    )
    assert bad_expiry.status_code == 422

    for index in range(5):
        response = mcp_client.post(
            "/settings/agent-access/tokens",
            json={"name": f"Muse {index}", "access_level": "read", "expires_in_days": 30},
            headers=headers,
        )
        assert response.status_code == 201

    over = mcp_client.post(
        "/settings/agent-access/tokens",
        json={"name": "Muse 6", "access_level": "read", "expires_in_days": 30},
        headers=headers,
    )
    assert over.status_code == 409
    assert over.json()["error"]["code"] == "agent_token_limit"


def test_turning_access_off_revokes_every_token(mcp_app: FastAPI, mcp_client: TestClient) -> None:
    headers = _settings_headers(mcp_app, mcp_client)
    token = _make_token(mcp_app)
    assert _rpc(mcp_client, token, "tools/list").status_code == 200

    off = mcp_client.put("/settings/agent-access", json={"enabled": False}, headers=headers)
    assert off.json() == {**off.json(), "enabled": False, "tokens": []}
    assert _rpc(mcp_client, token, "tools/list").status_code == 401

    # Turning it back on does not revive the old token.
    mcp_client.put("/settings/agent-access", json={"enabled": True}, headers=headers)
    assert _rpc(mcp_client, token, "tools/list").status_code == 401


# ----- MCP auth and transport ------------------------------------------------------------


def test_missing_token_gets_401_challenge_and_metadata(mcp_client: TestClient) -> None:
    response = _rpc(mcp_client, None, "tools/list")
    assert response.status_code == 401
    challenge = response.headers["www-authenticate"]
    assert challenge.startswith("Bearer ")
    assert (
        'resource_metadata="http://testserver/.well-known/oauth-protected-resource/mcp"'
        in challenge
    )

    metadata = mcp_client.get("/.well-known/oauth-protected-resource/mcp")
    assert metadata.status_code == 200
    assert metadata.json()["resource"] == "http://testserver/mcp"
    assert metadata.json()["bearer_methods_supported"] == ["header"]


def test_session_cookies_never_authenticate_mcp(mcp_app: FastAPI, mcp_client: TestClient) -> None:
    _settings_headers(mcp_app, mcp_client)
    response = _rpc(mcp_client, None, "tools/list")
    assert response.status_code == 401


def test_invalid_tokens_fail_closed(mcp_app: FastAPI, mcp_client: TestClient) -> None:
    _seed_user(mcp_app)
    _seed_user(mcp_app, user_id=OTHER_USER_ID, email="other@example.com")
    good = _make_token(mcp_app)
    assert _rpc(mcp_client, good, "tools/list").status_code == 200

    assert _rpc(mcp_client, "not-a-token", "tools/list").status_code == 401
    assert _rpc(mcp_client, "gust_mcp_" + "A" * 43, "tools/list").status_code == 401

    expired = _make_token(mcp_app, user_id=OTHER_USER_ID)
    with connection_scope(_db(mcp_app)) as connection:
        connection.execute(
            mcp_access_tokens.update()
            .where(mcp_access_tokens.c.token_hash == hash_token(expired))
            .values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
        )
    assert _rpc(mcp_client, expired, "tools/list").status_code == 401

    # Removing the email from the allowlist cuts the token off on the next call.
    with connection_scope(_db(mcp_app)) as connection:
        connection.execute(
            allowed_users.delete().where(allowed_users.c.email == "user@example.com")
        )
    assert _rpc(mcp_client, good, "tools/list").status_code == 401


def test_browser_origin_and_unknown_host_are_rejected(
    mcp_app: FastAPI,
    mcp_client: TestClient,
) -> None:
    _seed_user(mcp_app)
    token = _make_token(mcp_app)

    with_origin = _rpc(mcp_client, token, "tools/list", headers={"Origin": "https://evil.example"})
    assert with_origin.status_code == 403

    # frontend.test passes the app's trusted-host check but is not an MCP host.
    wrong_host = _rpc(mcp_client, token, "tools/list", headers={"Host": "frontend.test"})
    assert wrong_host.status_code == 421


def test_tools_list_has_every_tool_with_annotations(
    mcp_app: FastAPI,
    mcp_client: TestClient,
) -> None:
    _seed_user(mcp_app)
    token = _make_token(mcp_app, access_level="read")
    response = _rpc(mcp_client, token, "tools/list")
    tools = {tool["name"]: tool for tool in response.json()["result"]["tools"]}

    assert set(tools) == ALL_TOOLS
    assert tools["get_task"]["annotations"]["readOnlyHint"] is True
    assert tools["create_task"]["annotations"]["readOnlyHint"] is False
    assert tools["create_task"]["annotations"]["destructiveHint"] is False
    for name in ("delete_task", "delete_subtask", "delete_group"):
        assert tools[name]["annotations"]["destructiveHint"] is True
    assert tools["delete_subtask"]["description"].startswith("Permanently deletes")
    assert "reminder_at" in tools["create_task"]["inputSchema"]["properties"]


# ----- read tools ------------------------------------------------------------------------


def test_get_context_reports_timezone_groups_and_counts(
    mcp_app: FastAPI,
    mcp_client: TestClient,
) -> None:
    inbox = _seed_user(mcp_app, timezone_name="America/Toronto")
    work = _seed_group(mcp_app, user_id=USER_ID, name="Work")
    today = datetime.now(UTC).astimezone(__import__("zoneinfo").ZoneInfo("America/Toronto")).date()
    _seed_task(mcp_app, user_id=USER_ID, group_id=work, title="Late", due=today - timedelta(days=2))
    _seed_task(mcp_app, user_id=USER_ID, group_id=inbox, title="Today", due=today)
    token = _make_token(mcp_app, access_level="read")

    context = _ok(mcp_client, token, "get_context")

    assert context["timezone"] == "America/Toronto"
    assert context["today"] == today.isoformat()
    assert context["access"] == "read"
    assert context["inbox_group_id"] == inbox
    assert {group["name"]: group["open_task_count"] for group in context["groups"]} == {
        "Inbox": 1,
        "Work": 1,
    }
    assert context["open_task_counts"] == {"overdue": 1, "due_today": 1, "needs_review": 0}


def test_list_tasks_filters_and_isolation(mcp_app: FastAPI, mcp_client: TestClient) -> None:
    inbox = _seed_user(mcp_app)
    other_inbox = _seed_user(mcp_app, user_id=OTHER_USER_ID, email="other@example.com")
    work = _seed_group(mcp_app, user_id=USER_ID, name="Work")
    today = datetime.now(UTC).date()
    base = datetime(2026, 1, 1, tzinfo=UTC)
    _seed_task(
        mcp_app,
        user_id=USER_ID,
        group_id=work,
        title="Ship report",
        due=today,
        created_at=base,
    )
    _seed_task(
        mcp_app,
        user_id=USER_ID,
        group_id=inbox,
        title="Buy milk",
        description="x" * 500,
        due=today + timedelta(days=10),
        created_at=base + timedelta(hours=1),
    )
    _seed_task(
        mcp_app,
        user_id=USER_ID,
        group_id=inbox,
        title="Someday",
        created_at=base + timedelta(hours=2),
    )
    _seed_task(mcp_app, user_id=OTHER_USER_ID, group_id=other_inbox, title="Not yours", due=today)
    token = _make_token(mcp_app, access_level="read")

    everything = _ok(mcp_client, token, "list_tasks")
    assert {task["title"] for task in everything["tasks"]} == {"Ship report", "Buy milk", "Someday"}
    milk = next(task for task in everything["tasks"] if task["title"] == "Buy milk")
    assert len(milk["description_preview"]) == 200

    this_week = _ok(
        mcp_client,
        token,
        "list_tasks",
        {"due_start": today.isoformat(), "due_end": (today + timedelta(days=6)).isoformat()},
    )
    assert [task["title"] for task in this_week["tasks"]] == ["Ship report"]

    undated = _ok(mcp_client, token, "list_tasks", {"no_due_date": True})
    assert [task["title"] for task in undated["tasks"]] == ["Someday"]

    by_name = _ok(mcp_client, token, "list_tasks", {"group_name": "work"})
    assert [task["title"] for task in by_name["tasks"]] == ["Ship report"]

    searched = _ok(mcp_client, token, "list_tasks", {"query": "milk"})
    assert [task["title"] for task in searched["tasks"]] == ["Buy milk"]

    paged = _ok(mcp_client, token, "list_tasks", {"limit": 2})
    assert len(paged["tasks"]) == 2 and paged["has_more"] is True
    rest = _ok(mcp_client, token, "list_tasks", {"limit": 2, "cursor": paged["next_cursor"]})
    assert len(rest["tasks"]) == 1

    assert "No group has that name" in _error_text(
        mcp_client, token, "list_tasks", {"group_name": "Nope"}
    )
    # Another user's group ID is "not found", never a leak.
    assert "Group could not be found" in _error_text(
        mcp_client, token, "list_tasks", {"group_id": other_inbox}
    )


def test_get_task_full_detail_and_cross_user_not_found(
    mcp_app: FastAPI,
    mcp_client: TestClient,
) -> None:
    inbox = _seed_user(mcp_app)
    other_inbox = _seed_user(mcp_app, user_id=OTHER_USER_ID, email="other@example.com")
    task_id = _seed_task(
        mcp_app, user_id=USER_ID, group_id=inbox, title="Mine", description="d" * 500
    )
    other_task = _seed_task(mcp_app, user_id=OTHER_USER_ID, group_id=other_inbox, title="Theirs")
    token = _make_token(mcp_app, access_level="read")

    detail = _ok(mcp_client, token, "get_task", {"task_id": task_id})
    assert detail["description"] == "d" * 500
    assert detail["group"]["name"] == "Inbox"

    assert "Task could not be found" in _error_text(
        mcp_client, token, "get_task", {"task_id": other_task}
    )
    assert "Task could not be found" in _error_text(
        mcp_client, token, "get_task", {"task_id": "not-a-uuid"}
    )


# ----- write tools -----------------------------------------------------------------------


def test_read_token_is_denied_on_write_tools_and_audited(
    mcp_app: FastAPI,
    mcp_client: TestClient,
) -> None:
    _seed_user(mcp_app)
    token = _make_token(mcp_app, access_level="read")

    message = _error_text(mcp_client, token, "create_task", {"title": "Nope"})
    assert "read-only" in message
    with connection_scope(_db(mcp_app)) as connection:
        assert connection.execute(sa.select(sa.func.count(tasks.c.id))).scalar_one() == 0
    rows = _audit_rows(mcp_app)
    assert [(row.tool_name, row.outcome, row.error_code) for row in rows] == [
        ("create_task", "denied", "read_only_token")
    ]


@pytest.mark.parametrize(
    ("tool", "arguments"),
    [
        ("update_task", {"task_id": "TASK", "title": "Renamed"}),
        ("complete_task", {"task_id": "TASK"}),
        ("delete_task", {"task_id": "TASK"}),
        ("delete_subtask", {"task_id": "TASK", "subtask_id": "SUBTASK"}),
        ("delete_group", {"group_id": "GROUP", "move_tasks_to_group_name": "Inbox"}),
    ],
)
def test_read_token_is_denied_on_destructive_tools(
    mcp_app: FastAPI,
    mcp_client: TestClient,
    tool: str,
    arguments: dict[str, str],
) -> None:
    inbox = _seed_user(mcp_app)
    group_id = _seed_group(mcp_app, user_id=USER_ID, name="Errands")
    task_id = _seed_task(mcp_app, user_id=USER_ID, group_id=group_id, title="Keep me")
    subtask_id = str(uuid.uuid4())
    with connection_scope(_db(mcp_app)) as connection:
        connection.execute(
            subtasks.insert().values(id=subtask_id, user_id=USER_ID, task_id=task_id, title="s")
        )
    token = _make_token(mcp_app, access_level="read")
    ids = {"TASK": task_id, "SUBTASK": subtask_id, "GROUP": group_id}
    resolved = {key: ids.get(value, value) for key, value in arguments.items()}

    assert "read-only" in _error_text(mcp_client, token, tool, resolved)

    detail = _ok(mcp_client, token, "get_task", {"task_id": task_id})
    assert detail["title"] == "Keep me"
    assert detail["status"] == "open"
    assert detail["deleted_at"] is None
    assert detail["group"]["id"] == group_id
    assert [subtask["id"] for subtask in detail["subtasks"]] == [subtask_id]
    assert inbox != group_id


def test_write_tools_cannot_touch_another_users_data(
    mcp_app: FastAPI,
    mcp_client: TestClient,
) -> None:
    _seed_user(mcp_app)
    other_inbox = _seed_user(mcp_app, user_id=OTHER_USER_ID, email="other@example.com")
    other_group = _seed_group(mcp_app, user_id=OTHER_USER_ID, name="Theirs")
    other_task = _seed_task(mcp_app, user_id=OTHER_USER_ID, group_id=other_group, title="Theirs")
    other_subtask = str(uuid.uuid4())
    with connection_scope(_db(mcp_app)) as connection:
        connection.execute(
            subtasks.insert().values(
                id=other_subtask, user_id=OTHER_USER_ID, task_id=other_task, title="theirs"
            )
        )
    token = _make_token(mcp_app)

    calls = [
        ("update_task", {"task_id": other_task, "title": "Hijacked"}),
        ("complete_task", {"task_id": other_task}),
        ("delete_task", {"task_id": other_task}),
        ("add_subtask", {"task_id": other_task, "title": "Injected"}),
        ("update_subtask", {"task_id": other_task, "subtask_id": other_subtask, "title": "X"}),
        ("delete_subtask", {"task_id": other_task, "subtask_id": other_subtask}),
        ("update_group", {"group_id": other_group, "name": "Hijacked"}),
        ("delete_group", {"group_id": other_group, "move_tasks_to_group_name": "Inbox"}),
        ("create_task", {"title": "Into theirs", "group_id": other_group}),
    ]
    for tool, arguments in calls:
        assert "could not be found" in _error_text(mcp_client, token, tool, arguments), tool

    with connection_scope(_db(mcp_app)) as connection:
        task_row = connection.execute(sa.select(tasks).where(tasks.c.id == other_task)).one()
        group_row = connection.execute(sa.select(groups).where(groups.c.id == other_group)).one()
        subtask_rows = connection.execute(
            sa.select(subtasks.c.id, subtasks.c.title).where(subtasks.c.task_id == other_task)
        ).fetchall()
        mine = connection.execute(
            sa.select(sa.func.count(tasks.c.id)).where(tasks.c.user_id == USER_ID)
        ).scalar_one()
    assert (task_row.title, task_row.status, task_row.deleted_at) == ("Theirs", "open", None)
    assert task_row.group_id == other_group
    assert group_row.name == "Theirs"
    assert [(row.id, row.title) for row in subtask_rows] == [(other_subtask, "theirs")]
    assert mine == 0
    assert other_inbox != other_group


def test_create_task_with_subtasks_and_idempotent_retry(
    mcp_app: FastAPI,
    mcp_client: TestClient,
) -> None:
    _seed_user(mcp_app)
    work = _seed_group(mcp_app, user_id=USER_ID, name="Work")
    token = _make_token(mcp_app)
    tomorrow = (datetime.now(UTC).date() + timedelta(days=1)).isoformat()
    arguments = {
        "title": "Plan offsite",
        "group_name": "WORK",
        "due_date": tomorrow,
        "subtasks": ["Book room", "Send invites"],
        "idempotency_key": "muse-req-0001",
    }

    first = _ok(mcp_client, token, "create_task", arguments)
    assert first["replayed"] is False
    assert first["task"]["group"]["id"] == work
    assert first["task"]["needs_review"] is False
    assert [subtask["title"] for subtask in first["task"]["subtasks"]] == [
        "Book room",
        "Send invites",
    ]

    second = _ok(mcp_client, token, "create_task", arguments)
    assert second["replayed"] is True
    assert second["task"]["id"] == first["task"]["id"]
    with connection_scope(_db(mcp_app)) as connection:
        assert connection.execute(sa.select(sa.func.count(tasks.c.id))).scalar_one() == 1
        assert connection.execute(sa.select(sa.func.count(subtasks.c.id))).scalar_one() == 2

    reused = _error_text(
        mcp_client,
        token,
        "create_group",
        {"name": "Other", "idempotency_key": "muse-req-0001"},
    )
    assert "already used" in reused

    inbox_task = _ok(mcp_client, token, "create_task", {"title": "Loose end"})
    assert inbox_task["task"]["group"]["name"] == "Inbox"

    past = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    assert "must be in the future" in _error_text(
        mcp_client, token, "create_task", {"title": "Late", "reminder_at": past}
    )
    naive = _error_text(
        mcp_client,
        token,
        "create_task",
        {"title": "Naive", "reminder_at": "2030-01-01T09:00:00"},
    )
    assert "reminder_at" in naive


def test_create_tasks_is_all_or_nothing(mcp_app: FastAPI, mcp_client: TestClient) -> None:
    _seed_user(mcp_app)
    token = _make_token(mcp_app)
    yesterday = (datetime.now(UTC).date() - timedelta(days=1)).isoformat()

    message = _error_text(
        mcp_client,
        token,
        "create_tasks",
        {
            "tasks": [
                {"title": "Fine"},
                {"title": "Bad reminder", "reminder_date": yesterday},
                {"title": "Bad group", "group_name": "Missing"},
            ]
        },
    )
    assert "Nothing was created." in message
    assert "Task 2: Date-only reminder cannot be in the past." in message
    assert "Task 3: No group has that name" in message
    with connection_scope(_db(mcp_app)) as connection:
        assert connection.execute(sa.select(sa.func.count(tasks.c.id))).scalar_one() == 0

    created = _ok(
        mcp_client,
        token,
        "create_tasks",
        {
            "tasks": [{"title": "One"}, {"title": "Two", "subtasks": ["a"]}],
            "idempotency_key": "batch-0001",
        },
    )
    assert [task["title"] for task in created["tasks"]] == ["One", "Two"]
    replay = _ok(
        mcp_client,
        token,
        "create_tasks",
        {"tasks": [{"title": "One"}, {"title": "Two"}], "idempotency_key": "batch-0001"},
    )
    assert replay["replayed"] is True
    assert [task["id"] for task in replay["tasks"]] == [task["id"] for task in created["tasks"]]
    ok_rows = [row for row in _audit_rows(mcp_app) if row.outcome == "ok"]
    assert len(ok_rows) == 1 and len(ok_rows[0].target_ids) == 2


def test_update_task_is_partial_and_clears_explicitly(
    mcp_app: FastAPI,
    mcp_client: TestClient,
) -> None:
    inbox = _seed_user(mcp_app)
    _seed_group(mcp_app, user_id=USER_ID, name="Home")
    due = datetime.now(UTC).date() + timedelta(days=5)
    task_id = _seed_task(
        mcp_app,
        user_id=USER_ID,
        group_id=inbox,
        title="Old title",
        description="Keep me",
        due=due,
    )
    token = _make_token(mcp_app)

    renamed = _ok(mcp_client, token, "update_task", {"task_id": task_id, "title": "New title"})
    assert renamed["task"]["title"] == "New title"
    assert renamed["task"]["description"] == "Keep me"
    assert renamed["task"]["due_date"] == due.isoformat()

    moved = _ok(
        mcp_client,
        token,
        "update_task",
        {"task_id": task_id, "group_name": "home", "clear": ["due_date", "description"]},
    )
    assert moved["task"]["group"]["name"] == "Home"
    assert moved["task"]["due_date"] is None
    assert moved["task"]["description"] is None

    assert "at least one field" in _error_text(
        mcp_client, token, "update_task", {"task_id": task_id}
    )
    assert "Cannot both set and clear" in _error_text(
        mcp_client,
        token,
        "update_task",
        {"task_id": task_id, "due_date": due.isoformat(), "clear": ["due_date"]},
    )


def test_update_task_drops_a_reminder_that_already_passed(
    mcp_app: FastAPI,
    mcp_client: TestClient,
) -> None:
    inbox = _seed_user(mcp_app)
    task_id = _seed_task(
        mcp_app,
        user_id=USER_ID,
        group_id=inbox,
        title="Stale",
        due=datetime.now(UTC).date() + timedelta(days=3),
        reminder_at=datetime.now(UTC) - timedelta(hours=2),
    )
    token = _make_token(mcp_app)

    result = _ok(mcp_client, token, "update_task", {"task_id": task_id, "title": "Fresh"})
    assert result["task"]["title"] == "Fresh"
    assert result["task"]["reminder_at"] is None
    assert result["notes"] and "already passed" in result["notes"][0]


def test_complete_reopen_delete_restore_round_trip(
    mcp_app: FastAPI,
    mcp_client: TestClient,
) -> None:
    inbox = _seed_user(mcp_app)
    today = datetime.now(UTC).date()
    plain = _seed_task(mcp_app, user_id=USER_ID, group_id=inbox, title="Plain")
    daily = _seed_task(
        mcp_app,
        user_id=USER_ID,
        group_id=inbox,
        title="Daily",
        due=today,
        recurrence_frequency="daily",
    )
    token = _make_token(mcp_app)

    completed = _ok(mcp_client, token, "complete_task", {"task_id": plain})
    assert completed["task"]["status"] == "completed"
    assert completed["next_occurrence"] is None
    reopened = _ok(mcp_client, token, "reopen_task", {"task_id": plain})
    assert reopened["task"]["status"] == "open"

    recurring = _ok(mcp_client, token, "complete_task", {"task_id": daily})
    assert recurring["next_occurrence"]["title"] == "Daily"
    assert recurring["next_occurrence"]["due_date"] == (today + timedelta(days=1)).isoformat()

    deleted = _ok(mcp_client, token, "delete_task", {"task_id": plain})
    assert deleted["task"]["deleted_at"] is not None
    assert "restore_task" in deleted["note"]
    assert plain not in {task["id"] for task in _ok(mcp_client, token, "list_tasks")["tasks"]}
    assert "Restore the task first" in _error_text(
        mcp_client, token, "update_task", {"task_id": plain, "title": "x"}
    )
    restored = _ok(mcp_client, token, "restore_task", {"task_id": plain})
    assert restored["task"]["deleted_at"] is None

    assert "Series delete is only supported" in _error_text(
        mcp_client, token, "delete_task", {"task_id": plain, "scope": "series"}
    )


def test_subtask_tools(mcp_app: FastAPI, mcp_client: TestClient) -> None:
    inbox = _seed_user(mcp_app)
    other_inbox = _seed_user(mcp_app, user_id=OTHER_USER_ID, email="other@example.com")
    task_id = _seed_task(mcp_app, user_id=USER_ID, group_id=inbox, title="Parent")
    other_task = _seed_task(mcp_app, user_id=OTHER_USER_ID, group_id=other_inbox, title="Theirs")
    token = _make_token(mcp_app)

    added = _ok(mcp_client, token, "add_subtask", {"task_id": task_id, "title": "Step one"})
    subtask_id = added["subtask"]["id"]
    ticked = _ok(
        mcp_client,
        token,
        "update_subtask",
        {"task_id": task_id, "subtask_id": subtask_id, "is_completed": True},
    )
    assert ticked["subtask"]["is_completed"] is True
    assert ticked["subtask"]["title"] == "Step one"

    deleted = _ok(
        mcp_client, token, "delete_subtask", {"task_id": task_id, "subtask_id": subtask_id}
    )
    assert deleted["deleted"] is True
    assert "Subtask could not be found" in _error_text(
        mcp_client, token, "delete_subtask", {"task_id": task_id, "subtask_id": subtask_id}
    )
    assert "Task could not be found" in _error_text(
        mcp_client, token, "add_subtask", {"task_id": other_task, "title": "Sneaky"}
    )


def test_group_tools(mcp_app: FastAPI, mcp_client: TestClient) -> None:
    inbox = _seed_user(mcp_app)
    token = _make_token(mcp_app)

    created = _ok(mcp_client, token, "create_group", {"name": "Errands", "description": "Out"})
    group_id = created["group"]["id"]
    assert "already exists" in _error_text(mcp_client, token, "create_group", {"name": "errands"})

    updated = _ok(
        mcp_client,
        token,
        "update_group",
        {"group_id": group_id, "name": "Errands 2", "clear_description": True},
    )
    assert updated["group"]["name"] == "Errands 2"
    assert updated["description"] is None
    assert "System groups cannot be edited" in _error_text(
        mcp_client, token, "update_group", {"group_id": inbox, "name": "Renamed"}
    )

    task_id = _seed_task(mcp_app, user_id=USER_ID, group_id=group_id, title="Pick up parcel")
    assert "move_tasks_to_group" in _error_text(
        mcp_client, token, "delete_group", {"group_id": group_id}
    )
    assert "Inbox cannot be deleted" in _error_text(
        mcp_client,
        token,
        "delete_group",
        {"group_id": inbox, "move_tasks_to_group_id": group_id},
    )
    deleted = _ok(
        mcp_client,
        token,
        "delete_group",
        {"group_id": group_id, "move_tasks_to_group_name": "Inbox"},
    )
    assert deleted["tasks_moved_to"]["id"] == inbox
    moved = _ok(mcp_client, token, "get_task", {"task_id": task_id})
    assert moved["group"]["id"] == inbox


def test_write_rate_limit_per_token(app_factory) -> None:
    mcp_app = app_factory({**MCP_ENV, "RATE_LIMIT_MCP_WRITE_TOKEN": "2/60"})
    with TestClient(mcp_app) as client:
        _seed_user(mcp_app)
        token = _make_token(mcp_app)
        _ok(client, token, "create_task", {"title": "One"})
        _ok(client, token, "create_task", {"title": "Two"})
        assert "Rate limit exceeded" in _error_text(
            client, token, "create_task", {"title": "Three"}
        )
        # Reads have their own budget.
        _ok(client, token, "list_tasks")
    # Rate-limited calls are logged, not audited, so a looping agent cannot flood the table.
    assert [row for row in _audit_rows(mcp_app) if row.outcome == "denied"] == []


def test_read_only_denials_are_bounded_by_the_write_rate_limit(app_factory) -> None:
    mcp_app = app_factory({**MCP_ENV, "RATE_LIMIT_MCP_WRITE_TOKEN": "2/60"})
    with TestClient(mcp_app) as client:
        _seed_user(mcp_app)
        token = _make_token(mcp_app, access_level="read")
        for _ in range(2):
            assert "read-only" in _error_text(client, token, "create_task", {"title": "No"})
        for _ in range(3):
            assert "Rate limit exceeded" in _error_text(
                client, token, "create_task", {"title": "No"}
            )
    assert [row.error_code for row in _audit_rows(mcp_app)] == [
        "read_only_token",
        "read_only_token",
    ]


# ----- activity and retention ------------------------------------------------------------


def test_activity_lists_recent_writes_with_live_labels(
    mcp_app: FastAPI,
    mcp_client: TestClient,
) -> None:
    _settings_headers(mcp_app, mcp_client)
    token = _make_token(mcp_app)
    created = _ok(mcp_client, token, "create_task", {"title": "Visible title"})
    _ok(mcp_client, token, "update_task", {"task_id": created["task"]["id"], "title": "Renamed"})
    _error_text(mcp_client, token, "get_task", {"task_id": str(uuid.uuid4())})  # reads not audited

    activity = mcp_client.get("/settings/agent-access/activity")
    assert activity.status_code == 200
    items = activity.json()["items"]
    assert [item["tool_name"] for item in items] == ["update_task", "create_task"]
    assert {item["target_label"] for item in items} == {"Renamed"}
    assert {item["token_name"] for item in items} == {"Muse"}


def test_audit_purge_removes_only_expired_events(mcp_app: FastAPI, mcp_client: TestClient) -> None:
    _seed_user(mcp_app)
    token = _make_token(mcp_app)
    _ok(mcp_client, token, "create_task", {"title": "Recent"})
    with connection_scope(_db(mcp_app)) as connection:
        token_id = connection.execute(sa.select(mcp_access_tokens.c.id)).scalar_one()
        connection.execute(
            mcp_audit_events.insert().values(
                id=str(uuid.uuid4()),
                user_id=USER_ID,
                token_id=token_id,
                tool_name="create_task",
                outcome="ok",
                created_at=datetime.now(UTC) - timedelta(days=91),
            )
        )

    service = AgentAccessService(settings=mcp_app.state.settings)
    assert service.purge_expired_audit_events(now=datetime.now(UTC)) == 1
    assert len(_audit_rows(mcp_app)) == 1


def test_audit_purge_deletes_in_batches_up_to_a_cap(
    mcp_app: FastAPI,
    mcp_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _seed_user(mcp_app)
    _make_token(mcp_app)
    with connection_scope(_db(mcp_app)) as connection:
        token_id = connection.execute(sa.select(mcp_access_tokens.c.id)).scalar_one()
        for index in range(7):
            connection.execute(
                mcp_audit_events.insert().values(
                    id=str(uuid.uuid4()),
                    user_id=USER_ID,
                    token_id=token_id,
                    tool_name="create_task",
                    outcome="denied",
                    error_code="read_only_token",
                    created_at=datetime.now(UTC) - timedelta(days=100, minutes=index),
                )
            )
    monkeypatch.setattr("app.services.agent_access.AUDIT_PURGE_BATCH_SIZE", 2)
    monkeypatch.setattr("app.services.agent_access.AUDIT_PURGE_MAX_BATCHES", 3)
    service = AgentAccessService(settings=mcp_app.state.settings)

    assert service.purge_expired_audit_events(now=datetime.now(UTC)) == 6
    assert service.purge_expired_audit_events(now=datetime.now(UTC)) == 1
    assert _audit_rows(mcp_app) == []


def _principal(app: FastAPI, token: str):  # type: ignore[no-untyped-def]
    principal = AgentAccessService(settings=app.state.settings).resolve_bearer_token(token)
    assert principal is not None
    return principal


def test_concurrent_create_group_retry_replays_instead_of_conflicting(
    mcp_app: FastAPI,
    mcp_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _seed_user(mcp_app)
    principal = _principal(mcp_app, _make_token(mcp_app))
    operations = AgentOperations(settings=mcp_app.state.settings)
    first = operations.create_group(
        principal, name="Errands", description=None, idempotency_key="group-key-01"
    )

    # The retry's first lookup runs before the original call has committed, so it misses.
    original_find = operations._find_idempotent_event
    lookups: list[str] = []

    def racing_find(principal_arg, key):  # type: ignore[no-untyped-def]
        lookups.append(key)
        return None if len(lookups) == 1 else original_find(principal_arg, key)

    monkeypatch.setattr(operations, "_find_idempotent_event", racing_find)
    retried = operations.create_group(
        principal, name="Errands", description=None, idempotency_key="group-key-01"
    )

    assert retried.replayed is True
    assert retried.group.id == first.group.id
    assert len(lookups) == 2


def test_write_still_succeeds_when_its_audit_row_fails_after_commit(
    mcp_app: FastAPI,
    mcp_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    inbox = _seed_user(mcp_app)
    task_id = _seed_task(mcp_app, user_id=USER_ID, group_id=inbox, title="Parent")
    token = _make_token(mcp_app)

    def broken_insert(*args, **kwargs):  # type: ignore[no-untyped-def]
        raise RuntimeError("audit insert failed")

    monkeypatch.setattr("app.services.agent_operations.insert_mcp_audit_event", broken_insert)
    result = _ok(mcp_client, token, "add_subtask", {"task_id": task_id, "title": "Child"})

    assert result["subtask"]["title"] == "Child"
    with connection_scope(_db(mcp_app)) as connection:
        titles = (
            connection.execute(sa.select(subtasks.c.title).where(subtasks.c.task_id == task_id))
            .scalars()
            .all()
        )
    assert titles == ["Child"]


# ----- official client -------------------------------------------------------------------


def test_official_mcp_client_can_initialize_list_and_call(mcp_app: FastAPI) -> None:
    _seed_user(mcp_app)
    token = _make_token(mcp_app, access_level="read")

    async def run() -> tuple[str, set[str], dict]:
        async with (
            mcp_app.router.lifespan_context(mcp_app),
            httpx2.AsyncClient(
                transport=httpx2.ASGITransport(app=mcp_app),
                base_url="http://testserver",
                headers={"Authorization": f"Bearer {token}"},
            ) as http_client,
            streamable_http_client("http://testserver/mcp", http_client=http_client) as streams,
            ClientSession(streams[0], streams[1]) as session,
        ):
            initialized = await session.initialize()
            listed = await session.list_tools()
            called = await session.call_tool("get_context", {})
            assert called.is_error is False
            return (
                initialized.server_info.name,
                {tool.name for tool in listed.tools},
                called.structured_content,
            )

    server_name, tool_names, context = anyio.run(run)
    assert server_name == "gust"
    assert tool_names == ALL_TOOLS
    assert context["access"] == "read"
