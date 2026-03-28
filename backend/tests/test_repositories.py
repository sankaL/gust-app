from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
import sqlalchemy as sa

from app.db.engine import build_engine, connection_scope, dispose_all_engines
from app.db.repositories import (
    claim_due_reminders,
    create_capture,
    create_reminder,
    create_task,
    delete_expired_captures,
    ensure_inbox_group,
    get_session_context,
    get_task,
    list_groups_with_recent_tasks,
    requeue_expired_claims,
    update_user_timezone,
    upsert_user,
)
from app.db.schema import captures, groups, reminders, tasks


def test_user_upsert_and_inbox_bootstrap_are_idempotent(client) -> None:
    database_url = client.app.state.settings.database_url

    with connection_scope(database_url) as connection:
        first_user = upsert_user(
            connection,
            user_id="11111111-1111-1111-1111-111111111111",
            email="user@example.com",
            display_name="First Name",
            timezone="UTC",
        )
        second_user = upsert_user(
            connection,
            user_id="11111111-1111-1111-1111-111111111111",
            email="updated@example.com",
            display_name="Updated Name",
            timezone="America/Toronto",
        )
        inbox_first = ensure_inbox_group(connection, user_id=first_user.id)
        inbox_second = ensure_inbox_group(connection, user_id=first_user.id)

    assert second_user.email == "updated@example.com"
    assert second_user.timezone == "America/Toronto"
    assert inbox_first.id == inbox_second.id


def test_build_engine_reuses_cached_instance_and_disposes_cleanly(client) -> None:
    database_url = client.app.state.settings.database_url

    first_engine = build_engine(database_url)
    second_engine = build_engine(database_url)

    assert first_engine is second_engine

    dispose_all_engines()

    third_engine = build_engine(database_url)
    assert third_engine is not first_engine


def test_timezone_update_and_session_context_are_user_scoped(client) -> None:
    database_url = client.app.state.settings.database_url

    with connection_scope(database_url) as connection:
        upsert_user(
            connection,
            user_id="11111111-1111-1111-1111-111111111111",
            email="user@example.com",
            display_name="User One",
            timezone="UTC",
        )
        upsert_user(
            connection,
            user_id="22222222-2222-2222-2222-222222222222",
            email="other@example.com",
            display_name="User Two",
            timezone="UTC",
        )
        ensure_inbox_group(connection, user_id="11111111-1111-1111-1111-111111111111")
        ensure_inbox_group(connection, user_id="22222222-2222-2222-2222-222222222222")
        updated_user = update_user_timezone(
            connection,
            user_id="11111111-1111-1111-1111-111111111111",
            timezone="America/Toronto",
        )
        first_context = get_session_context(connection, "11111111-1111-1111-1111-111111111111")
        second_context = get_session_context(connection, "22222222-2222-2222-2222-222222222222")

    assert updated_user is not None
    assert updated_user.timezone == "America/Toronto"
    assert first_context is not None
    assert first_context.user.timezone == "America/Toronto"
    assert second_context is not None
    assert second_context.user.timezone == "UTC"
    assert first_context.inbox_group_id != second_context.inbox_group_id


def test_task_group_id_is_non_null_at_schema_level(client) -> None:
    database_url = client.app.state.settings.database_url

    with connection_scope(database_url) as connection:
        upsert_user(
            connection,
            user_id="11111111-1111-1111-1111-111111111111",
            email="user@example.com",
            display_name="User One",
            timezone="UTC",
        )
        ensure_inbox_group(connection, user_id="11111111-1111-1111-1111-111111111111")

        with pytest.raises(sa.exc.IntegrityError):
            connection.execute(
                tasks.insert().values(
                    id="44444444-4444-4444-4444-444444444444",
                    user_id="11111111-1111-1111-1111-111111111111",
                    group_id=None,
                    capture_id=None,
                    series_id=None,
                    title="Task without group",
                    status="open",
                    needs_review=False,
                )
            )


def test_due_reminder_claiming_requeues_expired_claims_and_ignores_ineligible_tasks(client) -> None:
    database_url = client.app.state.settings.database_url
    now = datetime.now(timezone.utc).replace(microsecond=0)

    with connection_scope(database_url) as connection:
        user = upsert_user(
            connection,
            user_id="11111111-1111-1111-1111-111111111111",
            email="user@example.com",
            display_name="User One",
            timezone="UTC",
        )
        inbox = ensure_inbox_group(connection, user_id=user.id)

        due_task = create_task(
            connection,
            user_id=user.id,
            group_id=inbox.id,
            capture_id=None,
            title="Due reminder",
            needs_review=False,
            due_date=date(2026, 3, 24),
            reminder_at=now - timedelta(minutes=1),
        )
        future_task = create_task(
            connection,
            user_id=user.id,
            group_id=inbox.id,
            capture_id=None,
            title="Future reminder",
            needs_review=False,
            due_date=date(2026, 3, 25),
            reminder_at=now + timedelta(hours=1),
        )
        deleted_task = create_task(
            connection,
            user_id=user.id,
            group_id=inbox.id,
            capture_id=None,
            title="Deleted task",
            needs_review=False,
            due_date=date(2026, 3, 24),
            reminder_at=now - timedelta(minutes=2),
        )
        connection.execute(
            tasks.update()
            .where(tasks.c.id == deleted_task.id)
            .values(deleted_at=now, updated_at=sa.text("CURRENT_TIMESTAMP"))
        )

        due_reminder = create_reminder(
            connection,
            user_id=user.id,
            task_id=due_task.id,
            scheduled_for=now - timedelta(minutes=1),
        )
        create_reminder(
            connection,
            user_id=user.id,
            task_id=future_task.id,
            scheduled_for=now + timedelta(hours=1),
        )
        deleted_reminder = create_reminder(
            connection,
            user_id=user.id,
            task_id=deleted_task.id,
            scheduled_for=now - timedelta(minutes=2),
        )
        connection.execute(
            reminders.update()
            .where(reminders.c.id == deleted_reminder.id)
            .values(status="cancelled", cancelled_at=now, updated_at=sa.text("CURRENT_TIMESTAMP"))
        )
        connection.execute(
            reminders.update()
            .where(reminders.c.id == due_reminder.id)
            .values(
                status="claimed",
                claim_token="stale-claim-token",
                claimed_at=now - timedelta(minutes=15),
                claim_expires_at=now - timedelta(minutes=5),
                updated_at=sa.text("CURRENT_TIMESTAMP"),
            )
        )

        requeued_count = requeue_expired_claims(connection, now=now)
        claimed = claim_due_reminders(
            connection,
            now=now,
            limit=10,
            claim_timeout_seconds=600,
        )

    assert requeued_count == 1
    assert [reminder.task_id for reminder in claimed] == [due_task.id]
    assert claimed[0].status == "claimed"
    assert claimed[0].claim_token is not None


def test_expired_capture_cleanup_deletes_rows_and_nulls_task_capture_id(client) -> None:
    database_url = client.app.state.settings.database_url
    now = datetime.now(timezone.utc).replace(microsecond=0)

    with connection_scope(database_url) as connection:
        user = upsert_user(
            connection,
            user_id="11111111-1111-1111-1111-111111111111",
            email="user@example.com",
            display_name="User One",
            timezone="UTC",
        )
        inbox = ensure_inbox_group(connection, user_id=user.id)
        capture = create_capture(
            connection,
            user_id=user.id,
            input_type="text",
            status="completed",
            source_text="capture text",
            transcript_text="capture text",
            expires_at=now - timedelta(days=1),
        )
        task = create_task(
            connection,
            user_id=user.id,
            group_id=inbox.id,
            capture_id=capture.id,
            title="Task from capture",
            needs_review=False,
            due_date=None,
            reminder_at=None,
        )

        deleted_count = delete_expired_captures(connection, now=now, limit=10)
        refreshed_task = get_task(connection, user_id=user.id, task_id=task.id)
        remaining_capture = connection.execute(
            sa.select(captures).where(captures.c.id == capture.id)
        ).first()

    assert deleted_count == 1
    assert remaining_capture is None
    assert refreshed_task is not None
    assert refreshed_task.capture_id is None


def test_list_groups_with_recent_tasks_returns_ranked_titles_per_group(client) -> None:
    database_url = client.app.state.settings.database_url
    now = datetime.now(timezone.utc).replace(microsecond=0)

    with connection_scope(database_url) as connection:
        user = upsert_user(
            connection,
            user_id="11111111-1111-1111-1111-111111111111",
            email="user@example.com",
            display_name="User One",
            timezone="UTC",
        )
        inbox = ensure_inbox_group(connection, user_id=user.id)
        work_group_id = "33333333-3333-3333-3333-333333333333"
        connection.execute(
            groups.insert().values(
                id=work_group_id,
                user_id=user.id,
                name="Work",
                description="Professional",
                is_system=False,
                system_key=None,
            )
        )

        inbox_newest = create_task(
            connection,
            user_id=user.id,
            group_id=inbox.id,
            capture_id=None,
            title="Inbox newest",
            needs_review=False,
        )
        inbox_older = create_task(
            connection,
            user_id=user.id,
            group_id=inbox.id,
            capture_id=None,
            title="Inbox older",
            needs_review=False,
        )
        work_newest = create_task(
            connection,
            user_id=user.id,
            group_id=work_group_id,
            capture_id=None,
            title="Work newest",
            needs_review=False,
        )
        work_older = create_task(
            connection,
            user_id=user.id,
            group_id=work_group_id,
            capture_id=None,
            title="Work older",
            needs_review=False,
        )
        connection.execute(
            tasks.update()
            .where(tasks.c.id == inbox_older.id)
            .values(created_at=now - timedelta(minutes=2), updated_at=sa.text("CURRENT_TIMESTAMP"))
        )
        connection.execute(
            tasks.update()
            .where(tasks.c.id == inbox_newest.id)
            .values(created_at=now - timedelta(minutes=1), updated_at=sa.text("CURRENT_TIMESTAMP"))
        )
        connection.execute(
            tasks.update()
            .where(tasks.c.id == work_older.id)
            .values(created_at=now - timedelta(minutes=4), updated_at=sa.text("CURRENT_TIMESTAMP"))
        )
        connection.execute(
            tasks.update()
            .where(tasks.c.id == work_newest.id)
            .values(created_at=now - timedelta(minutes=3), updated_at=sa.text("CURRENT_TIMESTAMP"))
        )

        grouped = list_groups_with_recent_tasks(connection, user_id=user.id, limit_per_group=2)

    grouped_by_name = {group.name: group.recent_task_titles for group in grouped}
    assert grouped_by_name["Inbox"] == ["Inbox newest", "Inbox older"]
    assert grouped_by_name["Work"] == ["Work newest", "Work older"]
