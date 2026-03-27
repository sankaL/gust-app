from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from typing import get_args

import pytest
import sqlalchemy as sa

from app.core.errors import ConfigurationError
from app.db.engine import connection_scope
from app.db.repositories import (
    create_capture,
    create_task,
    ensure_inbox_group,
    upsert_user,
)
from app.db.schema import captures, digest_dispatches
from app.services.reminders import (
    DIGEST_TIMEZONE,
    DigestMode,
    ReminderDeliveryError,
    ReminderRunSummary,
    ReminderSendResult,
    ReminderWorkerService,
    ResendReminderService,
)

USER_ID = "11111111-1111-1111-1111-111111111111"


@dataclass
class FakeReminderDeliveryService:
    mode: str = "success"
    requests: list[dict[str, str]] = field(default_factory=list)

    def ensure_configured(self) -> None:
        return None

    async def send_digest(
        self,
        *,
        to_email: str,
        subject: str,
        text_body: str,
        html_body: str,
        idempotency_key: str,
    ) -> ReminderSendResult:
        self.requests.append(
            {
                "to_email": to_email,
                "subject": subject,
                "text_body": text_body,
                "html_body": html_body,
                "idempotency_key": idempotency_key,
            }
        )
        if self.mode == "success":
            return ReminderSendResult(provider_message_id="provider-msg-123")
        raise ReminderDeliveryError(
            error_code="digest_provider_retryable",
            retryable=True,
        )


class MissingConfigReminderDeliveryService:
    def ensure_configured(self) -> None:
        raise ConfigurationError("Resend reminder configuration is missing.")

    async def send_digest(self, **kwargs) -> ReminderSendResult:
        del kwargs
        raise AssertionError("send should not be called when provider config is missing")


class FlakyReminderDeliveryService:
    def __init__(self) -> None:
        self.attempts = 0

    def ensure_configured(self) -> None:
        return None

    async def send_digest(self, **kwargs) -> ReminderSendResult:
        del kwargs
        self.attempts += 1
        if self.attempts == 1:
            raise ReminderDeliveryError(
                error_code="digest_provider_retryable",
                retryable=True,
            )
        return ReminderSendResult(provider_message_id="provider-msg-123")


def _seed_user_and_inbox(client) -> tuple[str, str]:
    with connection_scope(client.app.state.settings.database_url) as connection:
        upsert_user(
            connection,
            user_id=USER_ID,
            email="user@example.com",
            display_name="User One",
            timezone="UTC",
        )
        inbox = ensure_inbox_group(connection, user_id=USER_ID)
    return USER_ID, inbox.id


def _seed_open_task(
    client,
    *,
    title: str,
    due_date: date,
    recurrence_frequency: str | None = None,
    recurrence_weekday: int | None = None,
    recurrence_day_of_month: int | None = None,
) -> None:
    _, inbox_id = _seed_user_and_inbox(client)
    with connection_scope(client.app.state.settings.database_url) as connection:
        create_task(
            connection,
            user_id=USER_ID,
            group_id=inbox_id,
            capture_id=None,
            title=title,
            needs_review=False,
            due_date=due_date,
            reminder_at=None,
            recurrence_frequency=recurrence_frequency,
            recurrence_interval=1 if recurrence_frequency is not None else None,
            recurrence_weekday=recurrence_weekday,
            recurrence_day_of_month=recurrence_day_of_month,
        )


def _seed_completed_task(
    client,
    *,
    title: str,
    due_date: date,
    completed_at_utc: datetime,
) -> None:
    _, inbox_id = _seed_user_and_inbox(client)
    with connection_scope(client.app.state.settings.database_url) as connection:
        task = create_task(
            connection,
            user_id=USER_ID,
            group_id=inbox_id,
            capture_id=None,
            title=title,
            needs_review=False,
            due_date=due_date,
            reminder_at=None,
        )
        connection.execute(
            sa.text(
                """
                UPDATE tasks
                   SET status = 'completed',
                       completed_at = :completed_at,
                       updated_at = CURRENT_TIMESTAMP
                 WHERE id = :task_id
                """
            ),
            {
                "completed_at": completed_at_utc,
                "task_id": task.id,
            },
        )


def test_daily_digest_sends_and_tracks_dispatch(client) -> None:
    today_eastern = datetime.now(DIGEST_TIMEZONE).date()
    _seed_open_task(
        client,
        title="Pay rent",
        due_date=today_eastern,
        recurrence_frequency="weekly",
        recurrence_weekday=0,
    )
    _seed_open_task(
        client,
        title="Submit taxes",
        due_date=today_eastern - timedelta(days=2),
    )

    delivery = FakeReminderDeliveryService(mode="success")
    worker = ReminderWorkerService(
        settings=client.app.state.settings,
        reminder_delivery_service=delivery,
    )

    summary = asyncio.run(worker.run_due_work(mode="daily"))

    with connection_scope(client.app.state.settings.database_url) as connection:
        dispatch_rows = connection.execute(sa.select(digest_dispatches)).fetchall()

    assert summary == ReminderRunSummary(
        mode="daily",
        users_processed=1,
        sent=1,
        skipped_empty=0,
        failed=0,
        captures_deleted=0,
    )
    assert len(delivery.requests) == 1
    assert "Due today" in delivery.requests[0]["text_body"]
    assert "Overdue" in delivery.requests[0]["text_body"]
    assert "weekly (Sunday)" in delivery.requests[0]["text_body"]
    assert len(dispatch_rows) == 1
    assert dispatch_rows[0].status == "sent"
    assert dispatch_rows[0].provider_message_id == "provider-msg-123"


def test_daily_digest_skips_empty_and_tracks_status(client) -> None:
    today_eastern = datetime.now(DIGEST_TIMEZONE).date()
    _seed_open_task(client, title="Future task", due_date=today_eastern + timedelta(days=2))

    delivery = FakeReminderDeliveryService(mode="success")
    worker = ReminderWorkerService(
        settings=client.app.state.settings,
        reminder_delivery_service=delivery,
    )

    summary = asyncio.run(worker.run_due_work(mode="daily"))

    with connection_scope(client.app.state.settings.database_url) as connection:
        dispatch_rows = connection.execute(sa.select(digest_dispatches)).fetchall()

    assert summary.sent == 0
    assert summary.skipped_empty == 1
    assert summary.failed == 0
    assert delivery.requests == []
    assert len(dispatch_rows) == 1
    assert dispatch_rows[0].status == "skipped_empty"


def test_weekly_digest_sends_completed_and_due_uncompleted_sections(client) -> None:
    now_eastern = datetime.now(DIGEST_TIMEZONE)
    week_start = now_eastern.date() - timedelta(days=now_eastern.date().weekday())
    week_end = week_start + timedelta(days=6)

    completed_local = datetime.combine(week_start + timedelta(days=1), time(12, 0), tzinfo=DIGEST_TIMEZONE)
    _seed_completed_task(
        client,
        title="Completed item",
        due_date=week_start + timedelta(days=1),
        completed_at_utc=completed_local.astimezone(timezone.utc),
    )
    _seed_open_task(
        client,
        title="Uncompleted due item",
        due_date=week_end,
        recurrence_frequency="monthly",
        recurrence_day_of_month=week_end.day,
    )

    delivery = FakeReminderDeliveryService(mode="success")
    worker = ReminderWorkerService(
        settings=client.app.state.settings,
        reminder_delivery_service=delivery,
    )

    summary = asyncio.run(worker.run_due_work(mode="weekly"))

    with connection_scope(client.app.state.settings.database_url) as connection:
        dispatch_rows = connection.execute(sa.select(digest_dispatches)).fetchall()

    assert summary.sent == 1
    assert summary.skipped_empty == 0
    assert summary.failed == 0
    assert len(delivery.requests) == 1
    text_body = delivery.requests[0]["text_body"]
    assert "Completed this week" in text_body
    assert "Due this week and not completed" in text_body
    assert "completed:" in text_body
    assert "monthly (day" in text_body
    assert len(dispatch_rows) == 1
    assert dispatch_rows[0].status == "sent"


def test_digest_dispatch_idempotency_skips_already_sent_period(client) -> None:
    today_eastern = datetime.now(DIGEST_TIMEZONE).date()
    _seed_open_task(client, title="Pay rent", due_date=today_eastern)

    delivery = FakeReminderDeliveryService(mode="success")
    worker = ReminderWorkerService(
        settings=client.app.state.settings,
        reminder_delivery_service=delivery,
    )

    first_summary = asyncio.run(worker.run_due_work(mode="daily"))
    second_summary = asyncio.run(worker.run_due_work(mode="daily"))

    assert first_summary.sent == 1
    assert second_summary.sent == 0
    assert second_summary.skipped_empty == 0
    assert len(delivery.requests) == 1


def test_digest_retries_failed_period_on_next_run(client) -> None:
    today_eastern = datetime.now(DIGEST_TIMEZONE).date()
    _seed_open_task(client, title="Pay rent", due_date=today_eastern)

    flaky_delivery = FlakyReminderDeliveryService()
    worker = ReminderWorkerService(
        settings=client.app.state.settings,
        reminder_delivery_service=flaky_delivery,
    )

    first_summary = asyncio.run(worker.run_due_work(mode="daily"))
    second_summary = asyncio.run(worker.run_due_work(mode="daily"))

    with connection_scope(client.app.state.settings.database_url) as connection:
        dispatch_rows = connection.execute(sa.select(digest_dispatches)).fetchall()

    assert first_summary.failed == 1
    assert first_summary.sent == 0
    assert second_summary.sent == 1
    assert len(dispatch_rows) == 1
    assert dispatch_rows[0].status == "sent"


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
        asyncio.run(worker.run_due_work(mode="daily"))

    with connection_scope(client.app.state.settings.database_url) as connection:
        remaining_capture = connection.execute(
            sa.select(captures).where(captures.c.id == capture.id)
        ).first()

    assert remaining_capture is None


def test_resolve_weekly_period_uses_monday_start_in_eastern(client) -> None:
    service = ReminderWorkerService(
        settings=client.app.state.settings,
        reminder_delivery_service=FakeReminderDeliveryService(),
    )

    # 2026-04-01T15:00:00Z is Wednesday in Eastern.
    period = service._resolve_period(
        mode="weekly",
        now_utc=datetime(2026, 4, 1, 15, 0, tzinfo=timezone.utc),
    )

    assert period.start_date == date(2026, 3, 30)
    assert period.end_date == date(2026, 4, 5)


def test_daily_period_is_today_in_eastern(client) -> None:
    service = ReminderWorkerService(
        settings=client.app.state.settings,
        reminder_delivery_service=FakeReminderDeliveryService(),
    )

    period = service._resolve_period(
        mode="daily",
        now_utc=datetime(2026, 4, 1, 3, 30, tzinfo=timezone.utc),
    )

    # 03:30 UTC is still previous day in Eastern during DST.
    assert period.start_date == date(2026, 3, 31)
    assert period.end_date == date(2026, 3, 31)


def test_digest_mode_type_alias_is_str_literal() -> None:
    # Smoke check that the mode alias remains constrained.
    assert get_args(DigestMode) == ("daily", "weekly")


def test_resend_service_still_exposes_configuration_guard(client) -> None:
    settings = client.app.state.settings
    settings.resend_api_key = None
    service = ResendReminderService(settings)

    with pytest.raises(ConfigurationError):
        service.ensure_configured()
