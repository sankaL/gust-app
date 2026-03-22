from __future__ import annotations

import html
import logging
from dataclasses import asdict, dataclass
from datetime import date, datetime, timezone

import httpx

from app.core.errors import ConfigurationError
from app.core.settings import Settings
from app.db.engine import connection_scope
from app.db.repositories import (
    ReminderRecord,
    cancel_claimed_reminder,
    claim_due_reminders,
    delete_expired_captures,
    fail_claimed_reminder,
    get_reminder_by_id,
    get_task,
    get_user,
    mark_reminder_sent,
    requeue_claimed_reminder,
    requeue_expired_claims,
)

logger = logging.getLogger("gust.api")

INTERNAL_JOB_SECRET_HEADER = "X-Internal-Job-Secret"


@dataclass
class ReminderSendResult:
    provider_message_id: str


@dataclass
class ReminderRunSummary:
    claimed: int = 0
    sent: int = 0
    cancelled: int = 0
    requeued: int = 0
    failed: int = 0
    captures_deleted: int = 0

    def to_dict(self) -> dict[str, int]:
        return asdict(self)


class ReminderDeliveryError(Exception):
    def __init__(self, *, error_code: str, retryable: bool) -> None:
        super().__init__(error_code)
        self.error_code = error_code
        self.retryable = retryable


class ResendReminderService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def ensure_configured(self) -> None:
        if not self.settings.resend_api_key or not self.settings.resend_from_email:
            raise ConfigurationError("Resend reminder configuration is missing.")

    async def send(
        self,
        *,
        to_email: str,
        task_title: str,
        due_date: date,
        scheduled_for: datetime,
        idempotency_key: str,
    ) -> ReminderSendResult:
        self.ensure_configured()

        timeout = httpx.Timeout(self.settings.reminder_request_timeout_seconds)
        payload = {
            "from": self.settings.resend_from_email,
            "to": [to_email],
            "subject": f"Reminder: {task_title}",
            "text": self._build_text_body(
                task_title=task_title,
                due_date=due_date,
                scheduled_for=scheduled_for,
            ),
            "html": self._build_html_body(
                task_title=task_title,
                due_date=due_date,
                scheduled_for=scheduled_for,
            ),
        }
        headers = {
            "Authorization": f"Bearer {self.settings.resend_api_key}",
            "Content-Type": "application/json",
            "Idempotency-Key": idempotency_key,
        }

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(
                    self.settings.resend_api_url,
                    headers=headers,
                    json=payload,
                )
        except httpx.HTTPError as exc:
            raise ReminderDeliveryError(
                error_code="reminder_transport_error",
                retryable=True,
            ) from exc

        if response.status_code >= 500:
            raise ReminderDeliveryError(
                error_code="reminder_provider_unavailable",
                retryable=True,
            )
        if response.status_code in {408, 409, 425, 429}:
            raise ReminderDeliveryError(
                error_code="reminder_provider_retryable",
                retryable=True,
            )
        if response.status_code >= 400:
            raise ReminderDeliveryError(
                error_code="reminder_provider_rejected",
                retryable=False,
            )

        try:
            body = response.json()
        except ValueError as exc:
            raise ReminderDeliveryError(
                error_code="reminder_provider_invalid_json",
                retryable=False,
            ) from exc

        provider_message_id = body.get("id") if isinstance(body, dict) else None
        if not provider_message_id or not str(provider_message_id).strip():
            raise ReminderDeliveryError(
                error_code="reminder_provider_missing_id",
                retryable=False,
            )

        return ReminderSendResult(provider_message_id=str(provider_message_id))

    def _build_text_body(
        self,
        *,
        task_title: str,
        due_date: date,
        scheduled_for: datetime,
    ) -> str:
        lines = [
            f"Task: {task_title}",
            f"Due date: {due_date.isoformat()}",
            f"Reminder time (UTC): {scheduled_for.isoformat()}",
        ]
        if self.settings.frontend_app_url:
            lines.append(f"Open Gust: {self.settings.frontend_app_url.rstrip('/')}/tasks")
        return "\n".join(lines)

    def _build_html_body(
        self,
        *,
        task_title: str,
        due_date: date,
        scheduled_for: datetime,
    ) -> str:
        escaped_task_title = html.escape(task_title)
        body = [
            "<p>Gust reminder</p>",
            f"<p><strong>Task:</strong> {escaped_task_title}</p>",
            f"<p><strong>Due date:</strong> {due_date.isoformat()}</p>",
            f"<p><strong>Reminder time (UTC):</strong> {scheduled_for.isoformat()}</p>",
        ]
        if self.settings.frontend_app_url:
            tasks_url = f"{self.settings.frontend_app_url.rstrip('/')}/tasks"
            body.append(f'<p><a href="{tasks_url}">Open Gust</a></p>')
        return "".join(body)


class ReminderWorkerService:
    def __init__(
        self,
        *,
        settings: Settings,
        reminder_delivery_service: ResendReminderService,
    ) -> None:
        self.settings = settings
        self.reminder_delivery_service = reminder_delivery_service

    async def run_due_work(self) -> ReminderRunSummary:
        summary = ReminderRunSummary()
        now = datetime.now(timezone.utc)
        with connection_scope(self.settings.database_url) as connection:
            summary.requeued += requeue_expired_claims(connection, now=now)
            summary.captures_deleted = delete_expired_captures(
                connection,
                now=now,
                limit=self.settings.reminder_batch_size,
            )

        self.reminder_delivery_service.ensure_configured()

        with connection_scope(self.settings.database_url) as connection:
            claimed_rows = claim_due_reminders(
                connection,
                now=now,
                limit=self.settings.reminder_batch_size,
                claim_timeout_seconds=self.settings.reminder_claim_timeout_seconds,
            )
        summary.claimed = len(claimed_rows)

        for claimed in claimed_rows:
            outcome = await self._process_claimed_reminder(claimed=claimed, now=now)
            if outcome == "sent":
                summary.sent += 1
            elif outcome == "cancelled":
                summary.cancelled += 1
            elif outcome == "requeued":
                summary.requeued += 1
            elif outcome == "failed":
                summary.failed += 1

        return summary

    async def _process_claimed_reminder(
        self,
        *,
        claimed: ReminderRecord,
        now: datetime,
    ) -> str:
        current_reminder, task_title, task_due_date, recipient_email = self._load_send_context(
            claimed=claimed
        )
        if current_reminder is None:
            return "failed"
        if (
            task_title is None
            or task_due_date is None
            or recipient_email is None
            or current_reminder.status != "claimed"
            or current_reminder.claim_token != claimed.claim_token
            or self._as_utc(current_reminder.scheduled_for) > now
        ):
            self._cancel_claimed_reminder(claimed=claimed)
            return "cancelled"

        try:
            result = await self.reminder_delivery_service.send(
                to_email=recipient_email,
                task_title=task_title,
                due_date=task_due_date,
                scheduled_for=self._as_utc(current_reminder.scheduled_for),
                idempotency_key=current_reminder.idempotency_key,
            )
        except ReminderDeliveryError as exc:
            logger.warning(
                "reminder_delivery_failed",
                extra={
                    "event": "reminder_delivery_failed",
                    "user_id": claimed.user_id,
                    "task_id": claimed.task_id,
                    "error_code": exc.error_code,
                },
            )
            if exc.retryable:
                with connection_scope(self.settings.database_url) as connection:
                    requeue_claimed_reminder(
                        connection,
                        reminder_id=claimed.id,
                        claim_token=claimed.claim_token or "",
                        error_code=exc.error_code,
                    )
                return "requeued"

            with connection_scope(self.settings.database_url) as connection:
                fail_claimed_reminder(
                    connection,
                    reminder_id=claimed.id,
                    claim_token=claimed.claim_token or "",
                    error_code=exc.error_code,
                )
            return "failed"

        with connection_scope(self.settings.database_url) as connection:
            mark_reminder_sent(
                connection,
                reminder_id=claimed.id,
                claim_token=claimed.claim_token or "",
                provider_message_id=result.provider_message_id,
                sent_at=datetime.now(timezone.utc),
            )
        logger.info(
            "reminder_sent",
            extra={
                "event": "reminder_sent",
                "user_id": claimed.user_id,
                "task_id": claimed.task_id,
            },
        )
        return "sent"

    def _load_send_context(
        self,
        *,
        claimed: ReminderRecord,
    ) -> tuple[ReminderRecord | None, str | None, date | None, str | None]:
        with connection_scope(self.settings.database_url) as connection:
            reminder = get_reminder_by_id(connection, reminder_id=claimed.id)
            task = get_task(connection, user_id=claimed.user_id, task_id=claimed.task_id)
            user = get_user(connection, user_id=claimed.user_id)

        if (
            reminder is None
            or task is None
            or user is None
            or task.status != "open"
            or task.deleted_at is not None
        ):
            return (reminder, None, None, None)
        return (reminder, task.title, task.due_date, user.email)

    def _cancel_claimed_reminder(self, *, claimed: ReminderRecord) -> None:
        with connection_scope(self.settings.database_url) as connection:
            cancel_claimed_reminder(
                connection,
                reminder_id=claimed.id,
                claim_token=claimed.claim_token or "",
            )

    def _as_utc(self, value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
