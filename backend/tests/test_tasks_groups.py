from __future__ import annotations

# ruff: noqa: UP045
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.dependencies import get_auth_service
from app.core.security import ACCESS_TOKEN_COOKIE
from app.db.engine import connection_scope
from app.db.repositories import ensure_inbox_group, upsert_user
from app.db.schema import groups, reminders, subtasks, tasks
from app.services.auth import AuthenticatedIdentity

USER_ID = "11111111-1111-1111-1111-111111111111"
OTHER_USER_ID = "22222222-2222-2222-2222-222222222222"


@dataclass
class FakeAuthService:
    def ensure_configured(self) -> None:
        return None

    def validate_access_token(self, access_token: str) -> AuthenticatedIdentity:
        assert access_token == "access-token"
        return AuthenticatedIdentity(
            user_id=USER_ID,
            email="user@example.com",
            display_name="Gust User",
        )


def _override_auth_service(app: FastAPI) -> None:
    app.dependency_overrides[get_auth_service] = lambda: FakeAuthService()


def _seed_user(client: TestClient, *, user_id: str = USER_ID, timezone_name: str = "UTC") -> str:
    with connection_scope(client.app.state.settings.database_url) as connection:
        upsert_user(
            connection,
            user_id=user_id,
            email=f"{user_id}@example.com",
            display_name="Gust User",
            timezone=timezone_name,
        )
        inbox = ensure_inbox_group(connection, user_id=user_id)
    return inbox.id


def _seed_group(
    client: TestClient,
    *,
    user_id: str,
    name: str,
    description: Optional[str] = None,
) -> str:
    group_id = str(uuid.uuid4())
    with connection_scope(client.app.state.settings.database_url) as connection:
        connection.execute(
            groups.insert().values(
                id=group_id,
                user_id=user_id,
                name=name,
                description=description,
                is_system=False,
                system_key=None,
            )
        )
    return group_id


def _seed_task(
    client: TestClient,
    *,
    user_id: str,
    group_id: str,
    title: str,
    status: str = "open",
    needs_review: bool = False,
    due_date_value: Optional[date] = None,
    reminder_at_value: Optional[datetime] = None,
    series_id: Optional[str] = None,
    recurrence_frequency: Optional[str] = None,
    recurrence_interval: Optional[int] = None,
    recurrence_weekday: Optional[int] = None,
    recurrence_day_of_month: Optional[int] = None,
    deleted_at_value: Optional[datetime] = None,
) -> str:
    task_id = str(uuid.uuid4())
    completed_at = datetime.now(timezone.utc) if status == "completed" else None
    with connection_scope(client.app.state.settings.database_url) as connection:
        connection.execute(
            tasks.insert().values(
                id=task_id,
                user_id=user_id,
                group_id=group_id,
                capture_id=None,
                series_id=series_id,
                title=title,
                status=status,
                needs_review=needs_review,
                due_date=due_date_value,
                reminder_at=reminder_at_value,
                reminder_offset_minutes=None,
                recurrence_frequency=recurrence_frequency,
                recurrence_interval=recurrence_interval,
                recurrence_weekday=recurrence_weekday,
                recurrence_day_of_month=recurrence_day_of_month,
                completed_at=completed_at,
                deleted_at=deleted_at_value,
            )
        )
    return task_id


def _seed_reminder(
    client: TestClient,
    *,
    user_id: str,
    task_id: str,
    scheduled_for: datetime,
    status: str = "pending",
) -> None:
    with connection_scope(client.app.state.settings.database_url) as connection:
        connection.execute(
            reminders.insert().values(
                id=str(uuid.uuid4()),
                user_id=user_id,
                task_id=task_id,
                scheduled_for=scheduled_for,
                status=status,
                idempotency_key=f"task:{task_id}:scheduled:{scheduled_for.isoformat()}",
            )
        )


def _authenticated_headers(app: FastAPI, client: TestClient) -> dict[str, str]:
    _override_auth_service(app)
    _seed_user(client, user_id=USER_ID)
    client.cookies.set(ACCESS_TOKEN_COOKIE, "access-token")
    csrf_token = client.get("/auth/session").json()["csrf_token"]
    assert csrf_token is not None
    return {"X-CSRF-Token": csrf_token}


def test_group_and_task_mutations_require_csrf(app: FastAPI, client: TestClient) -> None:
    _override_auth_service(app)
    inbox_group_id = _seed_user(client, user_id=USER_ID)
    task_id = _seed_task(client, user_id=USER_ID, group_id=inbox_group_id, title="Draft roadmap")
    client.cookies.set(ACCESS_TOKEN_COOKIE, "access-token")

    create_group_response = client.post("/groups", json={"name": "Travel"})
    update_task_response = client.patch(
        f"/tasks/{task_id}",
        json={
            "title": "Updated roadmap",
            "group_id": inbox_group_id,
            "due_date": None,
            "reminder_at": None,
            "recurrence": None,
        },
    )

    assert create_group_response.status_code == 403
    assert update_task_response.status_code == 403


def test_group_crud_rejects_duplicates_and_system_updates(
    app: FastAPI,
    client: TestClient,
) -> None:
    headers = _authenticated_headers(app, client)
    inbox_group_id = client.get("/auth/session").json()["inbox_group_id"]

    create_response = client.post(
        "/groups",
        json={"name": "Work", "description": "Professional work"},
        headers=headers,
    )
    duplicate_response = client.post(
        "/groups",
        json={"name": "work", "description": None},
        headers=headers,
    )
    rename_inbox_response = client.patch(
        f"/groups/{inbox_group_id}",
        json={"name": "Not Inbox"},
        headers=headers,
    )

    assert create_response.status_code == 201
    assert duplicate_response.status_code == 409
    assert duplicate_response.json()["error"]["code"] == "group_name_conflict"
    assert rename_inbox_response.status_code == 422


def test_group_delete_reassigns_tasks_and_clears_review(app: FastAPI, client: TestClient) -> None:
    headers = _authenticated_headers(app, client)
    source_group_id = _seed_group(client, user_id=USER_ID, name="Source")
    destination_group_id = _seed_group(client, user_id=USER_ID, name="Destination")
    task_id = _seed_task(
        client,
        user_id=USER_ID,
        group_id=source_group_id,
        title="Move me",
        needs_review=True,
    )

    response = client.request(
        "DELETE",
        f"/groups/{source_group_id}",
        json={"destination_group_id": destination_group_id},
        headers=headers,
    )

    assert response.status_code == 200

    with connection_scope(client.app.state.settings.database_url) as connection:
        task_row = connection.execute(sa.select(tasks).where(tasks.c.id == task_id)).one()
        deleted_group = connection.execute(
            sa.select(groups).where(groups.c.id == source_group_id)
        ).first()

    assert deleted_group is None
    assert str(task_row.group_id) == destination_group_id
    assert task_row.needs_review is False


def test_group_delete_reassigns_soft_deleted_tasks_too(app: FastAPI, client: TestClient) -> None:
    headers = _authenticated_headers(app, client)
    source_group_id = _seed_group(client, user_id=USER_ID, name="Archive Source")
    destination_group_id = _seed_group(client, user_id=USER_ID, name="Archive Destination")
    deleted_task_id = _seed_task(
        client,
        user_id=USER_ID,
        group_id=source_group_id,
        title="Previously deleted task",
        deleted_at_value=datetime.now(timezone.utc),
    )

    response = client.request(
        "DELETE",
        f"/groups/{source_group_id}",
        json={"destination_group_id": destination_group_id},
        headers=headers,
    )

    assert response.status_code == 200

    with connection_scope(client.app.state.settings.database_url) as connection:
        task_row = connection.execute(sa.select(tasks).where(tasks.c.id == deleted_task_id)).one()
        deleted_group = connection.execute(
            sa.select(groups).where(groups.c.id == source_group_id)
        ).first()

    assert deleted_group is None
    assert str(task_row.group_id) == destination_group_id


def test_list_tasks_applies_sorting_and_user_scope(app: FastAPI, client: TestClient) -> None:
    headers = _authenticated_headers(app, client)
    group_id = _seed_group(client, user_id=USER_ID, name="Personal")
    other_group_id = _seed_group(client, user_id=OTHER_USER_ID, name="Other")
    _seed_user(client, user_id=OTHER_USER_ID)

    today = date.today()
    _seed_task(
        client,
        user_id=USER_ID,
        group_id=group_id,
        title="Old overdue",
        due_date_value=today - timedelta(days=2),
    )
    _seed_task(
        client,
        user_id=USER_ID,
        group_id=group_id,
        title="Flagged today",
        due_date_value=today,
        needs_review=True,
    )
    _seed_task(
        client,
        user_id=USER_ID,
        group_id=group_id,
        title="Tomorrow task",
        due_date_value=today + timedelta(days=1),
    )
    _seed_task(
        client,
        user_id=USER_ID,
        group_id=group_id,
        title="No date task",
        needs_review=True,
    )
    _seed_task(
        client,
        user_id=OTHER_USER_ID,
        group_id=other_group_id,
        title="Other user task",
        due_date_value=today,
    )

    response = client.get(f"/tasks?group_id={group_id}", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert [item["title"] for item in payload] == [
        "Old overdue",
        "Flagged today",
        "Tomorrow task",
        "No date task",
    ]
    assert [item["due_bucket"] for item in payload] == [
        "overdue",
        "due_soon",
        "due_soon",
        "no_date",
    ]


def test_update_task_syncs_reminder_and_series_id(app: FastAPI, client: TestClient) -> None:
    headers = _authenticated_headers(app, client)
    first_group_id = _seed_group(client, user_id=USER_ID, name="Inbox Mirror")
    second_group_id = _seed_group(client, user_id=USER_ID, name="Work")
    task_id = _seed_task(
        client,
        user_id=USER_ID,
        group_id=first_group_id,
        title="Review route contracts",
        needs_review=True,
    )

    reminder_at_value = (datetime.now(timezone.utc) + timedelta(days=2)).replace(microsecond=0)
    update_response = client.patch(
        f"/tasks/{task_id}",
        json={
            "title": "Review task route contracts",
            "group_id": second_group_id,
            "due_date": str(date.today() + timedelta(days=2)),
            "reminder_at": reminder_at_value.isoformat().replace("+00:00", "Z"),
            "recurrence": {"frequency": "weekly", "weekday": 2, "day_of_month": None},
        },
        headers=headers,
    )

    assert update_response.status_code == 200

    with connection_scope(client.app.state.settings.database_url) as connection:
        task_row = connection.execute(sa.select(tasks).where(tasks.c.id == task_id)).one()
        reminder_row = connection.execute(sa.select(reminders)).one()

    assert str(task_row.group_id) == second_group_id
    assert task_row.needs_review is False
    assert task_row.series_id is not None
    assert task_row.recurrence_frequency == "weekly"
    assert reminder_row.status == "pending"

    clear_response = client.patch(
        f"/tasks/{task_id}",
        json={
            "title": "Review task route contracts",
            "group_id": second_group_id,
            "due_date": None,
            "reminder_at": None,
            "recurrence": None,
        },
        headers=headers,
    )

    assert clear_response.status_code == 200

    with connection_scope(client.app.state.settings.database_url) as connection:
        cleared_task_row = connection.execute(sa.select(tasks).where(tasks.c.id == task_id)).one()
        cleared_reminder_row = connection.execute(sa.select(reminders)).one()

    assert cleared_task_row.series_id is None
    assert cleared_task_row.recurrence_frequency is None
    assert cleared_task_row.reminder_at is None
    assert cleared_reminder_row.status == "cancelled"


def test_complete_reopen_delete_restore_manage_reminders(
    app: FastAPI,
    client: TestClient,
) -> None:
    headers = _authenticated_headers(app, client)
    group_id = _seed_group(client, user_id=USER_ID, name="Home")
    reminder_at_value = (datetime.now(timezone.utc) + timedelta(days=1)).replace(microsecond=0)
    task_id = _seed_task(
        client,
        user_id=USER_ID,
        group_id=group_id,
        title="Buy groceries",
        due_date_value=date.today() + timedelta(days=1),
        reminder_at_value=reminder_at_value,
    )
    _seed_reminder(client, user_id=USER_ID, task_id=task_id, scheduled_for=reminder_at_value)

    complete_response = client.post(f"/tasks/{task_id}/complete", headers=headers)
    reopen_response = client.post(f"/tasks/{task_id}/reopen", headers=headers)
    delete_response = client.request("DELETE", f"/tasks/{task_id}", headers=headers)
    restore_response = client.post(f"/tasks/{task_id}/restore", headers=headers)

    assert complete_response.status_code == 200
    assert reopen_response.status_code == 200
    assert delete_response.status_code == 200
    assert restore_response.status_code == 200

    with connection_scope(client.app.state.settings.database_url) as connection:
        task_row = connection.execute(sa.select(tasks).where(tasks.c.id == task_id)).one()
        reminder_row = connection.execute(
            sa.select(reminders).where(reminders.c.task_id == task_id)
        ).one()

    assert task_row.status == "open"
    assert task_row.completed_at is None
    assert task_row.deleted_at is None
    assert reminder_row.status == "pending"


def test_subtask_crud_and_user_scoping(app: FastAPI, client: TestClient) -> None:
    headers = _authenticated_headers(app, client)
    group_id = _seed_group(client, user_id=USER_ID, name="Errands")
    task_id = _seed_task(client, user_id=USER_ID, group_id=group_id, title="Plan weekend")
    other_group_id = _seed_group(client, user_id=OTHER_USER_ID, name="Other Group")
    _seed_user(client, user_id=OTHER_USER_ID)
    other_task_id = _seed_task(
        client,
        user_id=OTHER_USER_ID,
        group_id=other_group_id,
        title="Other task",
    )

    create_response = client.post(
        f"/tasks/{task_id}/subtasks",
        json={"title": "Buy paint"},
        headers=headers,
    )
    subtask_id = create_response.json()["id"]

    update_response = client.patch(
        f"/tasks/{task_id}/subtasks/{subtask_id}",
        json={"title": "Buy blue paint", "is_completed": True},
        headers=headers,
    )
    forbidden_response = client.patch(
        f"/tasks/{other_task_id}/subtasks/{subtask_id}",
        json={"title": "Should fail"},
        headers=headers,
    )
    delete_response = client.request(
        "DELETE",
        f"/tasks/{task_id}/subtasks/{subtask_id}",
        headers=headers,
    )

    assert create_response.status_code == 201
    assert update_response.status_code == 200
    assert update_response.json()["is_completed"] is True
    assert forbidden_response.status_code == 404
    assert delete_response.status_code == 200

    with connection_scope(client.app.state.settings.database_url) as connection:
        subtask_rows = connection.execute(sa.select(subtasks)).fetchall()

    assert subtask_rows == []
