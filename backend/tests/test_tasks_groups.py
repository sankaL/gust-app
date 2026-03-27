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
    reminder_offset_minutes: Optional[int] = None,
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
                reminder_offset_minutes=reminder_offset_minutes,
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
    _seed_user(client, user_id=OTHER_USER_ID)
    other_group_id = _seed_group(client, user_id=OTHER_USER_ID, name="Other")

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
    assert [item["title"] for item in payload["items"]] == [
        "Old overdue",
        "Flagged today",
        "Tomorrow task",
        "No date task",
    ]
    assert [item["due_bucket"] for item in payload["items"]] == [
        "overdue",
        "due_soon",
        "due_soon",
        "no_date",
    ]


def test_update_task_keeps_digest_only_reminder_state_and_series_id(
    app: FastAPI,
    client: TestClient,
) -> None:
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
        reminder_rows = connection.execute(sa.select(reminders)).fetchall()

    assert str(task_row.group_id) == second_group_id
    assert task_row.needs_review is False
    assert task_row.series_id is not None
    assert task_row.recurrence_frequency == "weekly"
    assert reminder_rows == []

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
        cleared_reminder_rows = connection.execute(sa.select(reminders)).fetchall()

    assert cleared_task_row.series_id is None
    assert cleared_task_row.recurrence_frequency is None
    assert cleared_task_row.reminder_at is None
    assert cleared_reminder_rows == []


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
    assert reminder_row.status == "cancelled"


def test_complete_task_rejects_when_already_completed(app: FastAPI, client: TestClient) -> None:
    headers = _authenticated_headers(app, client)
    group_id = _seed_group(client, user_id=USER_ID, name="Already Completed")
    task_id = _seed_task(
        client,
        user_id=USER_ID,
        group_id=group_id,
        title="Done already",
        status="completed",
    )

    response = client.post(f"/tasks/{task_id}/complete", headers=headers)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "task_completion_conflict"


def test_complete_recurring_task_rejects_if_due_date_is_in_future(
    app: FastAPI,
    client: TestClient,
) -> None:
    headers = _authenticated_headers(app, client)
    group_id = _seed_group(client, user_id=USER_ID, name="Future Completion Guard")
    tomorrow = datetime.now(timezone.utc).date() + timedelta(days=1)
    task_id = _seed_task(
        client,
        user_id=USER_ID,
        group_id=group_id,
        title="Future recurring",
        due_date_value=tomorrow,
        recurrence_frequency="daily",
        recurrence_interval=1,
        series_id=str(uuid.uuid4()),
    )

    response = client.post(f"/tasks/{task_id}/complete", headers=headers)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "task_completion_conflict"


def test_complete_task_creates_next_daily_occurrence_with_reset_subtasks(
    app: FastAPI,
    client: TestClient,
) -> None:
    headers = _authenticated_headers(app, client)
    group_id = _seed_group(client, user_id=USER_ID, name="Recurring")
    series_id = str(uuid.uuid4())
    today = datetime.now(timezone.utc).date()
    reminder_at_value = datetime.combine(today, datetime.min.time(), tzinfo=timezone.utc) + timedelta(
        hours=9
    )
    task_id = _seed_task(
        client,
        user_id=USER_ID,
        group_id=group_id,
        title="Daily standup",
        due_date_value=today,
        reminder_at_value=reminder_at_value,
        reminder_offset_minutes=540,
        series_id=series_id,
        recurrence_frequency="daily",
        recurrence_interval=1,
    )

    with connection_scope(client.app.state.settings.database_url) as connection:
        connection.execute(
            subtasks.insert().values(
                id=str(uuid.uuid4()),
                task_id=task_id,
                user_id=USER_ID,
                title="Review blockers",
                is_completed=True,
                completed_at=datetime.now(timezone.utc),
            )
        )
    _seed_reminder(client, user_id=USER_ID, task_id=task_id, scheduled_for=reminder_at_value)

    response = client.post(f"/tasks/{task_id}/complete", headers=headers)

    assert response.status_code == 200

    with connection_scope(client.app.state.settings.database_url) as connection:
        task_rows = connection.execute(
            sa.select(tasks)
            .where(tasks.c.series_id == series_id)
            .order_by(tasks.c.created_at.asc(), tasks.c.id.asc())
        ).fetchall()
        original_row = next(row for row in task_rows if str(row.id) == task_id)
        next_row = next(row for row in task_rows if str(row.id) != task_id)
        next_task_id = str(next_row.id)
        next_subtask_rows = connection.execute(
            sa.select(subtasks).where(subtasks.c.task_id == next_task_id)
        ).fetchall()
        reminder_rows = connection.execute(
            sa.select(reminders).where(reminders.c.task_id == next_task_id)
        ).fetchall()

    assert len(task_rows) == 2
    assert original_row.status == "completed"
    assert next_row.status == "open"
    assert next_row.due_date == today + timedelta(days=1)
    assert next_row.series_id == series_id
    assert next_row.needs_review is False
    assert next_row.reminder_at == (reminder_at_value + timedelta(days=1)).replace(
        tzinfo=None
    )
    assert len(next_subtask_rows) == 1
    assert next_subtask_rows[0].title == "Review blockers"
    assert next_subtask_rows[0].is_completed is False
    assert next_subtask_rows[0].completed_at is None
    assert reminder_rows == []


def test_complete_task_repairs_missing_series_id_and_generates_next_occurrence(
    app: FastAPI,
    client: TestClient,
) -> None:
    headers = _authenticated_headers(app, client)
    group_id = _seed_group(client, user_id=USER_ID, name="Legacy Recurring")
    today = datetime.now(timezone.utc).date()
    task_id = _seed_task(
        client,
        user_id=USER_ID,
        group_id=group_id,
        title="Legacy recurring",
        due_date_value=today,
        recurrence_frequency="daily",
        recurrence_interval=1,
        series_id=None,
    )

    response = client.post(f"/tasks/{task_id}/complete", headers=headers)

    assert response.status_code == 200

    with connection_scope(client.app.state.settings.database_url) as connection:
        original_row = connection.execute(sa.select(tasks).where(tasks.c.id == task_id)).one()
        assert original_row.series_id is not None
        task_rows = connection.execute(
            sa.select(tasks)
            .where(tasks.c.series_id == original_row.series_id)
            .order_by(tasks.c.created_at.asc(), tasks.c.id.asc())
        ).fetchall()

    assert len(task_rows) == 2
    assert any(row.status == "open" and row.deleted_at is None for row in task_rows)


def test_delete_task_occurrence_creates_next_occurrence_from_due_date(
    app: FastAPI,
    client: TestClient,
) -> None:
    headers = _authenticated_headers(app, client)
    group_id = _seed_group(client, user_id=USER_ID, name="Delete Occurrence")
    series_id = str(uuid.uuid4())
    today = datetime.now(timezone.utc).date()
    recurrence_weekday = (today.weekday() + 1) % 7
    reminder_at_value = datetime.combine(today, datetime.min.time(), tzinfo=timezone.utc) + timedelta(
        hours=23
    )
    task_id = _seed_task(
        client,
        user_id=USER_ID,
        group_id=group_id,
        title="Weekly planning",
        due_date_value=today,
        reminder_at_value=reminder_at_value,
        reminder_offset_minutes=1380,
        series_id=series_id,
        recurrence_frequency="weekly",
        recurrence_interval=1,
        recurrence_weekday=recurrence_weekday,
    )
    _seed_reminder(client, user_id=USER_ID, task_id=task_id, scheduled_for=reminder_at_value)

    response = client.request(
        "DELETE",
        f"/tasks/{task_id}?scope=occurrence",
        headers=headers,
    )

    assert response.status_code == 200

    with connection_scope(client.app.state.settings.database_url) as connection:
        task_rows = connection.execute(
            sa.select(tasks)
            .where(tasks.c.series_id == series_id)
            .order_by(tasks.c.created_at.asc(), tasks.c.id.asc())
        ).fetchall()
        original_row = next(row for row in task_rows if str(row.id) == task_id)
        next_row = next(row for row in task_rows if str(row.id) != task_id)
        original_reminder = connection.execute(
            sa.select(reminders).where(reminders.c.task_id == task_id)
        ).one()
        next_reminder = connection.execute(
            sa.select(reminders).where(reminders.c.task_id == next_row.id)
        ).fetchall()

    assert len(task_rows) == 2
    assert original_row.deleted_at is not None
    assert original_row.status == "open"
    assert next_row.status == "open"
    assert next_row.deleted_at is None
    assert next_row.due_date == today + timedelta(days=7)
    assert original_reminder.status == "cancelled"
    assert next_reminder == []


def test_delete_occurrence_repairs_missing_series_id_and_generates_next_occurrence(
    app: FastAPI,
    client: TestClient,
) -> None:
    headers = _authenticated_headers(app, client)
    group_id = _seed_group(client, user_id=USER_ID, name="Legacy Delete")
    today = datetime.now(timezone.utc).date()
    task_id = _seed_task(
        client,
        user_id=USER_ID,
        group_id=group_id,
        title="Legacy delete recurring",
        due_date_value=today,
        recurrence_frequency="daily",
        recurrence_interval=1,
        series_id=None,
    )

    response = client.request(
        "DELETE",
        f"/tasks/{task_id}?scope=occurrence",
        headers=headers,
    )

    assert response.status_code == 200

    with connection_scope(client.app.state.settings.database_url) as connection:
        original_row = connection.execute(sa.select(tasks).where(tasks.c.id == task_id)).one()
        assert original_row.series_id is not None
        task_rows = connection.execute(
            sa.select(tasks)
            .where(tasks.c.series_id == original_row.series_id)
            .order_by(tasks.c.created_at.asc(), tasks.c.id.asc())
        ).fetchall()

    assert len(task_rows) == 2
    assert any(row.status == "open" and row.deleted_at is None for row in task_rows)


def test_delete_task_series_soft_deletes_open_occurrences_only(
    app: FastAPI,
    client: TestClient,
) -> None:
    headers = _authenticated_headers(app, client)
    group_id = _seed_group(client, user_id=USER_ID, name="Delete Series")
    series_id = str(uuid.uuid4())
    today = datetime.now(timezone.utc).date()
    open_task_id = _seed_task(
        client,
        user_id=USER_ID,
        group_id=group_id,
        title="Series task",
        due_date_value=today,
        series_id=series_id,
        recurrence_frequency="daily",
        recurrence_interval=1,
    )
    second_open_task_id = _seed_task(
        client,
        user_id=USER_ID,
        group_id=group_id,
        title="Series task",
        due_date_value=today + timedelta(days=1),
        series_id=series_id,
        recurrence_frequency="daily",
        recurrence_interval=1,
    )
    completed_task_id = _seed_task(
        client,
        user_id=USER_ID,
        group_id=group_id,
        title="Series task",
        status="completed",
        due_date_value=today - timedelta(days=1),
        series_id=series_id,
        recurrence_frequency="daily",
        recurrence_interval=1,
    )

    first_reminder = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(hours=2)
    second_reminder = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(hours=3)
    _seed_reminder(client, user_id=USER_ID, task_id=open_task_id, scheduled_for=first_reminder)
    _seed_reminder(client, user_id=USER_ID, task_id=second_open_task_id, scheduled_for=second_reminder)

    response = client.request(
        "DELETE",
        f"/tasks/{open_task_id}?scope=series",
        headers=headers,
    )

    assert response.status_code == 200

    with connection_scope(client.app.state.settings.database_url) as connection:
        open_row = connection.execute(sa.select(tasks).where(tasks.c.id == open_task_id)).one()
        second_open_row = connection.execute(sa.select(tasks).where(tasks.c.id == second_open_task_id)).one()
        completed_row = connection.execute(sa.select(tasks).where(tasks.c.id == completed_task_id)).one()
        open_reminder = connection.execute(
            sa.select(reminders).where(reminders.c.task_id == open_task_id)
        ).one()
        second_open_reminder = connection.execute(
            sa.select(reminders).where(reminders.c.task_id == second_open_task_id)
        ).one()

    assert open_row.deleted_at is not None
    assert second_open_row.deleted_at is not None
    assert completed_row.deleted_at is None
    assert completed_row.status == "completed"
    assert open_reminder.status == "cancelled"
    assert second_open_reminder.status == "cancelled"


def test_delete_task_rejects_when_already_deleted(app: FastAPI, client: TestClient) -> None:
    headers = _authenticated_headers(app, client)
    group_id = _seed_group(client, user_id=USER_ID, name="Delete Guard")
    task_id = _seed_task(
        client,
        user_id=USER_ID,
        group_id=group_id,
        title="Deleted already",
        deleted_at_value=datetime.now(timezone.utc),
    )

    response = client.request("DELETE", f"/tasks/{task_id}", headers=headers)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "task_delete_conflict"


def test_complete_task_monthly_recurrence_uses_new_occurrence_day_of_month(
    app: FastAPI,
    client: TestClient,
) -> None:
    headers = _authenticated_headers(app, client)
    group_id = _seed_group(client, user_id=USER_ID, name="Billing")
    series_id = str(uuid.uuid4())
    today = datetime.now(timezone.utc).date()
    task_id = _seed_task(
        client,
        user_id=USER_ID,
        group_id=group_id,
        title="Close monthly books",
        due_date_value=today,
        series_id=series_id,
        recurrence_frequency="monthly",
        recurrence_interval=1,
        recurrence_day_of_month=today.day,
    )

    response = client.post(f"/tasks/{task_id}/complete", headers=headers)

    assert response.status_code == 200

    with connection_scope(client.app.state.settings.database_url) as connection:
        task_rows = connection.execute(
            sa.select(tasks)
            .where(tasks.c.series_id == series_id)
            .order_by(tasks.c.created_at.asc(), tasks.c.id.asc())
        ).fetchall()

    next_row = [row for row in task_rows if str(row.id) != task_id][0]
    assert len(task_rows) == 2
    assert next_row.status == "open"
    assert next_row.recurrence_frequency == "monthly"
    assert next_row.recurrence_day_of_month == next_row.due_date.day


def test_complete_task_skips_new_occurrence_when_series_already_has_open_task(
    app: FastAPI,
    client: TestClient,
) -> None:
    headers = _authenticated_headers(app, client)
    group_id = _seed_group(client, user_id=USER_ID, name="Series Guard")
    series_id = str(uuid.uuid4())
    today = datetime.now(timezone.utc).date()
    task_id = _seed_task(
        client,
        user_id=USER_ID,
        group_id=group_id,
        title="Weekly review",
        due_date_value=today,
        series_id=series_id,
        recurrence_frequency="weekly",
        recurrence_interval=1,
        recurrence_weekday=((today.weekday() + 2) % 7),
    )
    _seed_task(
        client,
        user_id=USER_ID,
        group_id=group_id,
        title="Weekly review",
        due_date_value=today + timedelta(days=1),
        series_id=series_id,
        recurrence_frequency="weekly",
        recurrence_interval=1,
        recurrence_weekday=((today.weekday() + 2) % 7),
    )

    response = client.post(f"/tasks/{task_id}/complete", headers=headers)

    assert response.status_code == 200

    with connection_scope(client.app.state.settings.database_url) as connection:
        open_series_rows = connection.execute(
            sa.select(tasks).where(
                tasks.c.series_id == series_id,
                tasks.c.status == "open",
                tasks.c.deleted_at.is_(None),
            )
        ).fetchall()

    assert len(open_series_rows) == 1


def test_complete_task_clears_past_derived_inherited_reminder(
    app: FastAPI,
    client: TestClient,
) -> None:
    headers = _authenticated_headers(app, client)
    group_id = _seed_group(client, user_id=USER_ID, name="Past Reminder")
    series_id = str(uuid.uuid4())
    today = datetime.now(timezone.utc).date()
    reminder_at_value = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(hours=1)
    task_id = _seed_task(
        client,
        user_id=USER_ID,
        group_id=group_id,
        title="Daily review",
        due_date_value=today,
        reminder_at_value=reminder_at_value,
        reminder_offset_minutes=-1500,
        series_id=series_id,
        recurrence_frequency="daily",
        recurrence_interval=1,
    )
    _seed_reminder(client, user_id=USER_ID, task_id=task_id, scheduled_for=reminder_at_value)

    response = client.post(f"/tasks/{task_id}/complete", headers=headers)

    assert response.status_code == 200

    with connection_scope(client.app.state.settings.database_url) as connection:
        next_row = connection.execute(
            sa.select(tasks)
            .where(
                tasks.c.series_id == series_id,
                tasks.c.status == "open",
                tasks.c.deleted_at.is_(None),
            )
        ).one()
        next_reminders = connection.execute(
            sa.select(reminders).where(reminders.c.task_id == next_row.id)
        ).fetchall()

    assert next_row.reminder_at is None
    assert next_reminders == []


def test_reopen_recurring_task_reuses_generated_occurrence_as_undo_target(
    app: FastAPI,
    client: TestClient,
) -> None:
    headers = _authenticated_headers(app, client)
    group_id = _seed_group(client, user_id=USER_ID, name="Undo Series")
    series_id = str(uuid.uuid4())
    today = datetime.now(timezone.utc).date()
    reminder_at_value = datetime.combine(today, datetime.min.time(), tzinfo=timezone.utc) + timedelta(
        hours=9
    )
    task_id = _seed_task(
        client,
        user_id=USER_ID,
        group_id=group_id,
        title="Daily stretch",
        due_date_value=today,
        reminder_at_value=reminder_at_value,
        reminder_offset_minutes=540,
        series_id=series_id,
        recurrence_frequency="daily",
        recurrence_interval=1,
    )
    _seed_reminder(client, user_id=USER_ID, task_id=task_id, scheduled_for=reminder_at_value)

    complete_response = client.post(f"/tasks/{task_id}/complete", headers=headers)
    reopen_response = client.post(f"/tasks/{task_id}/reopen", headers=headers)

    assert complete_response.status_code == 200
    assert reopen_response.status_code == 200

    with connection_scope(client.app.state.settings.database_url) as connection:
        task_rows = connection.execute(
            sa.select(tasks)
            .where(tasks.c.series_id == series_id)
            .order_by(tasks.c.created_at.asc(), tasks.c.id.asc())
        ).fetchall()
        generated_task = next(row for row in task_rows if str(row.id) != task_id)
        generated_reminder = connection.execute(
            sa.select(reminders).where(reminders.c.task_id == generated_task.id)
        ).fetchall()
        open_rows = [
            row
            for row in task_rows
            if row.status == "open" and row.deleted_at is None
        ]

    assert len(open_rows) == 1
    assert str(open_rows[0].id) == task_id
    assert str(open_rows[0].series_id) == series_id
    assert open_rows[0].recurrence_frequency == "daily"
    assert generated_task.deleted_at is not None
    assert generated_reminder == []


def test_reopen_recurring_task_keeps_series_and_generates_single_next_on_recomplete(
    app: FastAPI,
    client: TestClient,
) -> None:
    headers = _authenticated_headers(app, client)
    group_id = _seed_group(client, user_id=USER_ID, name="Reopen Keep Series")
    series_id = str(uuid.uuid4())
    today = datetime.now(timezone.utc).date()
    task_id = _seed_task(
        client,
        user_id=USER_ID,
        group_id=group_id,
        title="Daily mobility",
        due_date_value=today,
        series_id=series_id,
        recurrence_frequency="daily",
        recurrence_interval=1,
    )

    first_complete_response = client.post(f"/tasks/{task_id}/complete", headers=headers)
    reopen_response = client.post(f"/tasks/{task_id}/reopen", headers=headers)
    second_complete_response = client.post(f"/tasks/{task_id}/complete", headers=headers)

    assert first_complete_response.status_code == 200
    assert reopen_response.status_code == 200
    assert second_complete_response.status_code == 200

    with connection_scope(client.app.state.settings.database_url) as connection:
        task_rows = connection.execute(
            sa.select(tasks)
            .where(tasks.c.series_id == series_id)
            .order_by(tasks.c.created_at.asc(), tasks.c.id.asc())
        ).fetchall()
        open_rows = [
            row
            for row in task_rows
            if row.status == "open" and row.deleted_at is None
        ]
        deleted_rows = [row for row in task_rows if row.deleted_at is not None]

    assert len(task_rows) == 3
    assert len(open_rows) == 1
    assert open_rows[0].due_date == today + timedelta(days=1)
    assert len(deleted_rows) == 1


def test_restore_deleted_recurring_task_reuses_generated_occurrence_as_undo_target(
    app: FastAPI,
    client: TestClient,
) -> None:
    headers = _authenticated_headers(app, client)
    group_id = _seed_group(client, user_id=USER_ID, name="Restore Series")
    series_id = str(uuid.uuid4())
    today = datetime.now(timezone.utc).date()
    reminder_at_value = datetime.combine(today, datetime.min.time(), tzinfo=timezone.utc) + timedelta(
        hours=9
    )
    task_id = _seed_task(
        client,
        user_id=USER_ID,
        group_id=group_id,
        title="Daily cleanup",
        due_date_value=today,
        reminder_at_value=reminder_at_value,
        reminder_offset_minutes=540,
        series_id=series_id,
        recurrence_frequency="daily",
        recurrence_interval=1,
    )
    _seed_reminder(client, user_id=USER_ID, task_id=task_id, scheduled_for=reminder_at_value)

    delete_response = client.request(
        "DELETE",
        f"/tasks/{task_id}?scope=occurrence",
        headers=headers,
    )
    restore_response = client.post(f"/tasks/{task_id}/restore", headers=headers)

    assert delete_response.status_code == 200
    assert restore_response.status_code == 200

    with connection_scope(client.app.state.settings.database_url) as connection:
        task_rows = connection.execute(
            sa.select(tasks)
            .where(tasks.c.series_id == series_id)
            .order_by(tasks.c.created_at.asc(), tasks.c.id.asc())
        ).fetchall()
        generated_task = next(row for row in task_rows if str(row.id) != task_id)
        generated_reminder = connection.execute(
            sa.select(reminders).where(reminders.c.task_id == generated_task.id)
        ).fetchall()
        open_rows = [
            row
            for row in task_rows
            if row.status == "open" and row.deleted_at is None
        ]

    assert len(open_rows) == 1
    assert str(open_rows[0].id) == task_id
    assert str(open_rows[0].series_id) == series_id
    assert open_rows[0].recurrence_frequency == "daily"
    assert generated_task.deleted_at is not None
    assert generated_reminder == []


def test_reopen_recurring_task_returns_single_non_recurring_instance_when_no_open_occurrence_exists(
    app: FastAPI,
    client: TestClient,
) -> None:
    headers = _authenticated_headers(app, client)
    group_id = _seed_group(client, user_id=USER_ID, name="Reopen Instance Only")
    series_id = str(uuid.uuid4())
    today = datetime.now(timezone.utc).date()
    task_id = _seed_task(
        client,
        user_id=USER_ID,
        group_id=group_id,
        title="Weekly cleanup",
        status="completed",
        due_date_value=today,
        series_id=series_id,
        recurrence_frequency="weekly",
        recurrence_interval=1,
        recurrence_weekday=((today.weekday() + 1) % 7),
    )

    response = client.post(f"/tasks/{task_id}/reopen", headers=headers)

    assert response.status_code == 200

    with connection_scope(client.app.state.settings.database_url) as connection:
        task_row = connection.execute(sa.select(tasks).where(tasks.c.id == task_id)).one()

    assert task_row.status == "open"
    assert task_row.series_id is None
    assert task_row.recurrence_frequency is None


def test_restore_deleted_recurring_task_returns_single_non_recurring_instance_when_no_open_occurrence_exists(
    app: FastAPI,
    client: TestClient,
) -> None:
    headers = _authenticated_headers(app, client)
    group_id = _seed_group(client, user_id=USER_ID, name="Restore Instance Only")
    series_id = str(uuid.uuid4())
    today = datetime.now(timezone.utc).date()
    task_id = _seed_task(
        client,
        user_id=USER_ID,
        group_id=group_id,
        title="Monthly cleanup",
        due_date_value=today,
        deleted_at_value=datetime.now(timezone.utc),
        series_id=series_id,
        recurrence_frequency="monthly",
        recurrence_interval=1,
        recurrence_day_of_month=today.day,
    )

    response = client.post(f"/tasks/{task_id}/restore", headers=headers)

    assert response.status_code == 200

    with connection_scope(client.app.state.settings.database_url) as connection:
        task_row = connection.execute(sa.select(tasks).where(tasks.c.id == task_id)).one()

    assert task_row.status == "open"
    assert task_row.deleted_at is None
    assert task_row.series_id is None
    assert task_row.recurrence_frequency is None


def test_reopen_recurring_task_detaches_when_series_has_other_open_occurrence(
    app: FastAPI,
    client: TestClient,
) -> None:
    """When reopening a recurring task that has another open occurrence in the series,
    the task should be detached from the series (made non-recurring) so users can
    still access their accidentally-completed work."""
    headers = _authenticated_headers(app, client)
    group_id = _seed_group(client, user_id=USER_ID, name="Reopen Detach")
    series_id = str(uuid.uuid4())
    today = datetime.now(timezone.utc).date()
    task_id = _seed_task(
        client,
        user_id=USER_ID,
        group_id=group_id,
        title="Weekly sync",
        due_date_value=today,
        series_id=series_id,
        recurrence_frequency="weekly",
        recurrence_interval=1,
        recurrence_weekday=((today.weekday() + 2) % 7),
    )

    with connection_scope(client.app.state.settings.database_url) as connection:
        connection.execute(
            tasks.update()
            .where(tasks.c.id == task_id)
            .values(
                status="completed",
                completed_at=datetime.now(timezone.utc),
                updated_at=sa.text("CURRENT_TIMESTAMP"),
            )
        )
    # Create a manually adjusted open task in the same series
    _seed_task(
        client,
        user_id=USER_ID,
        group_id=group_id,
        title="Manually adjusted weekly sync",
        due_date_value=today + timedelta(days=14),
        series_id=series_id,
        recurrence_frequency="weekly",
        recurrence_interval=1,
        recurrence_weekday=((today.weekday() + 2) % 7),
    )

    reopen_response = client.post(f"/tasks/{task_id}/reopen", headers=headers)

    # Should succeed by detaching the task from the series
    assert reopen_response.status_code == 200
    task_data = reopen_response.json()
    assert task_data["status"] == "open"
    assert task_data["series_id"] is None
    assert task_data["recurrence_frequency"] is None


def test_restore_deleted_recurring_task_detaches_when_series_has_other_open_occurrence(
    app: FastAPI,
    client: TestClient,
) -> None:
    """When restoring a deleted recurring task that has another open occurrence in
    the series, the task should be detached from the series (made non-recurring)."""
    headers = _authenticated_headers(app, client)
    group_id = _seed_group(client, user_id=USER_ID, name="Restore Detach")
    series_id = str(uuid.uuid4())
    today = datetime.now(timezone.utc).date()
    task_id = _seed_task(
        client,
        user_id=USER_ID,
        group_id=group_id,
        title="Weekly sync",
        due_date_value=today,
        deleted_at_value=datetime.now(timezone.utc),
        series_id=series_id,
        recurrence_frequency="weekly",
        recurrence_interval=1,
        recurrence_weekday=((today.weekday() + 2) % 7),
    )
    # Create a manually adjusted open task in the same series
    _seed_task(
        client,
        user_id=USER_ID,
        group_id=group_id,
        title="Manually adjusted weekly sync",
        due_date_value=today + timedelta(days=14),
        series_id=series_id,
        recurrence_frequency="weekly",
        recurrence_interval=1,
        recurrence_weekday=((today.weekday() + 2) % 7),
    )

    restore_response = client.post(f"/tasks/{task_id}/restore", headers=headers)

    # Should succeed by detaching the task from the series
    assert restore_response.status_code == 200
    task_data = restore_response.json()
    assert task_data["status"] == "open"
    assert task_data["series_id"] is None
    assert task_data["recurrence_frequency"] is None


def test_subtask_crud_and_user_scoping(app: FastAPI, client: TestClient) -> None:
    headers = _authenticated_headers(app, client)
    group_id = _seed_group(client, user_id=USER_ID, name="Errands")
    task_id = _seed_task(client, user_id=USER_ID, group_id=group_id, title="Plan weekend")
    _seed_user(client, user_id=OTHER_USER_ID)
    other_group_id = _seed_group(client, user_id=OTHER_USER_ID, name="Other Group")
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
