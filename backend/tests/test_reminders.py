from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

import pytest
import sqlalchemy as sa

from app.core.errors import ConfigurationError
from app.db.engine import connection_scope
from app.db.repositories import (
    claim_due_reminders,
    create_capture,
    create_reminder,
    create_task,
    ensure_inbox_group,
    get_reminder_by_id,
    get_task,
    upsert_user,
)
from app.db.schema import captures, reminders, tasks
from app.services.reminders import (
    ReminderDeliveryError,
    ReminderRunSummary,
    ReminderSendResult,
    ReminderWorkerService,
)

USER_ID = "11111111-1111-1111-1111-111111111111"


@dataclass
class FakeReminderDeliveryService:
    mode: str = "success"

    def ensure_configured(self) -> None:
        return None

    async def send(self, **kwargs) -> ReminderSendResult:
        del kwargs
        if self.mode == "success":
            return ReminderSendResult(provider_message_id="provider-msg-123")
        if self.mode == "retryable":
            raise ReminderDeliveryError(
                error_code="reminder_provider_retryable",
                retryable=True,
            )
        raise ReminderDeliveryError(
            error_code="reminder_provider_rejected",
            retryable=False,
        )


class MissingConfigReminderDeliveryService:
    def ensure_configured(self) -> None:
        raise ConfigurationError("Resend reminder configuration is missing.")

    async def send(self, **kwargs) -> ReminderSendResult:
        del kwargs
        raise AssertionError("send should not be called when provider config is missing")


def _seed_user_and_inbox(client) -> str:
    with connection_scope(client.app.state.settings.database_url) as connection:
        upsert_user(
            connection,
            user_id=USER_ID,
            email="user@example.com",
            display_name="User One",
            timezone="UTC",
        )
        inbox = ensure_inbox_group(connection, user_id=USER_ID)
    return inbox.id


def _seed_due_task_with_reminder(client, *, title: str = "Pay rent") -> tuple[str, str]:
    now = datetime.now(timezone.utc).replace(microsecond=0)
    inbox_id = _seed_user_and_inbox(client)
    with connection_scope(client.app.state.settings.database_url) as connection:
        task = create_task(
            connection,
            user_id=USER_ID,
            group_id=inbox_id,
            capture_id=None,
            title=title,
            needs_review=False,
            due_date=date(2026, 3, 24),
            reminder_at=now - timedelta(minutes=1),
        )
        reminder = create_reminder(
            connection,
            user_id=USER_ID,
            task_id=task.id,
            scheduled_for=now - timedelta(minutes=1),
        )
    return (task.id, reminder.id)


def test_reminder_worker_marks_successful_delivery_as_sent(client) -> None:
    task_id, reminder_id = _seed_due_task_with_reminder(client)
    worker = ReminderWorkerService(
        settings=client.app.state.settings,
        reminder_delivery_service=FakeReminderDeliveryService(mode="success"),
    )

    summary = asyncio.run(worker.run_due_work())

    with connection_scope(client.app.state.settings.database_url) as connection:
        reminder = get_reminder_by_id(connection, reminder_id=reminder_id)

    assert summary == ReminderRunSummary(claimed=1, sent=1, cancelled=0, requeued=0, failed=0, captures_deleted=0)
    assert reminder is not None
    assert reminder.status == "sent"
    assert reminder.provider_message_id == "provider-msg-123"
    assert reminder.send_attempt_count == 1
    assert reminder.sent_at is not None
    assert reminder.task_id == task_id


def test_reminder_worker_requeues_retryable_failures(client) -> None:
    _task_id, reminder_id = _seed_due_task_with_reminder(client, title="Retry me")
    worker = ReminderWorkerService(
        settings=client.app.state.settings,
        reminder_delivery_service=FakeReminderDeliveryService(mode="retryable"),
    )

    summary = asyncio.run(worker.run_due_work())

    with connection_scope(client.app.state.settings.database_url) as connection:
        reminder = get_reminder_by_id(connection, reminder_id=reminder_id)

    assert summary.requeued == 1
    assert summary.failed == 0
    assert reminder is not None
    assert reminder.status == "pending"
    assert reminder.send_attempt_count == 1
    assert reminder.last_error_code == "reminder_provider_retryable"


def test_reminder_worker_marks_terminal_failures_failed(client) -> None:
    _task_id, reminder_id = _seed_due_task_with_reminder(client, title="Fail me")
    worker = ReminderWorkerService(
        settings=client.app.state.settings,
        reminder_delivery_service=FakeReminderDeliveryService(mode="failed"),
    )

    summary = asyncio.run(worker.run_due_work())

    with connection_scope(client.app.state.settings.database_url) as connection:
        reminder = get_reminder_by_id(connection, reminder_id=reminder_id)

    assert summary.failed == 1
    assert reminder is not None
    assert reminder.status == "failed"
    assert reminder.send_attempt_count == 1
    assert reminder.last_error_code == "reminder_provider_rejected"


def test_claimed_reminder_cancels_when_task_becomes_invalid_before_send(client) -> None:
    task_id, reminder_id = _seed_due_task_with_reminder(client, title="Cancel me")
    worker = ReminderWorkerService(
        settings=client.app.state.settings,
        reminder_delivery_service=FakeReminderDeliveryService(mode="success"),
    )

    now = datetime.now(timezone.utc).replace(microsecond=0)
    with connection_scope(client.app.state.settings.database_url) as connection:
        claimed = claim_due_reminders(
            connection,
            now=now,
            limit=10,
            claim_timeout_seconds=600,
        )
        connection.execute(
            tasks.update()
            .where(tasks.c.id == task_id)
            .values(status="completed", completed_at=now, updated_at=sa.text("CURRENT_TIMESTAMP"))
        )

    outcome = asyncio.run(worker._process_claimed_reminder(claimed=claimed[0], now=now))

    with connection_scope(client.app.state.settings.database_url) as connection:
        reminder = get_reminder_by_id(connection, reminder_id=reminder_id)
        task = get_task(connection, user_id=USER_ID, task_id=task_id)

    assert outcome == "cancelled"
    assert task is not None
    assert task.status == "completed"
    assert reminder is not None
    assert reminder.status == "cancelled"
    assert reminder.cancelled_at is not None


def test_reminder_worker_still_cleans_up_expired_captures_when_provider_unconfigured(client) -> None:
    _seed_user_and_inbox(client)
    now = datetime.now(timezone.utc).replace(microsecond=0)

    with connection_scope(client.app.state.settings.database_url) as connection:
        capture = create_capture(
            connection,
            user_id=USER_ID,
            input_type="text",
            status="completed",
            source_text="stale capture",
            transcript_text="stale capture",
            expires_at=now - timedelta(days=1),
        )

    worker = ReminderWorkerService(
        settings=client.app.state.settings,
        reminder_delivery_service=MissingConfigReminderDeliveryService(),
    )

    with pytest.raises(ConfigurationError):
        asyncio.run(worker.run_due_work())

    with connection_scope(client.app.state.settings.database_url) as connection:
        remaining_capture = connection.execute(
            sa.select(captures).where(captures.c.id == capture.id)
        ).first()

    assert remaining_capture is None
