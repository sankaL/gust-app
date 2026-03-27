from __future__ import annotations

import html
import logging
from dataclasses import asdict, dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo

import httpx

from app.core.errors import ConfigurationError
from app.core.settings import Settings
from app.db.engine import connection_scope
from app.db.repositories import (
    DigestTaskRecord,
    UserRecord,
    delete_expired_captures,
    get_digest_dispatch,
    list_completed_tasks_between,
    list_open_tasks_due_between_dates,
    list_open_tasks_due_on_date,
    list_open_tasks_overdue_before_date,
    list_users,
    upsert_digest_dispatch,
)

logger = logging.getLogger("gust.api")

INTERNAL_JOB_SECRET_HEADER = "X-Internal-Job-Secret"
DIGEST_TIMEZONE = ZoneInfo("America/New_York")

DigestMode = Literal["daily", "weekly"]
DigestDispatchStatus = Literal["sent", "failed", "skipped_empty"]


@dataclass
class DigestPeriod:
    start_date: date
    end_date: date
    completed_start_utc: datetime | None = None
    completed_end_utc: datetime | None = None


@dataclass
class ReminderSendResult:
    provider_message_id: str


@dataclass
class ReminderRunSummary:
    mode: DigestMode
    users_processed: int = 0
    sent: int = 0
    skipped_empty: int = 0
    failed: int = 0
    captures_deleted: int = 0

    def to_dict(self) -> dict[str, int | str]:
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

    async def send_digest(
        self,
        *,
        to_email: str,
        subject: str,
        text_body: str,
        html_body: str,
        idempotency_key: str,
    ) -> ReminderSendResult:
        self.ensure_configured()

        timeout = httpx.Timeout(self.settings.reminder_request_timeout_seconds)
        payload = {
            "from": self.settings.resend_from_email,
            "to": [to_email],
            "subject": subject,
            "text": text_body,
            "html": html_body,
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
                error_code="digest_transport_error",
                retryable=True,
            ) from exc

        if response.status_code >= 500:
            raise ReminderDeliveryError(
                error_code="digest_provider_unavailable",
                retryable=True,
            )
        if response.status_code in {408, 409, 425, 429}:
            raise ReminderDeliveryError(
                error_code="digest_provider_retryable",
                retryable=True,
            )
        if response.status_code >= 400:
            raise ReminderDeliveryError(
                error_code="digest_provider_rejected",
                retryable=False,
            )

        try:
            body = response.json()
        except ValueError as exc:
            raise ReminderDeliveryError(
                error_code="digest_provider_invalid_json",
                retryable=False,
            ) from exc

        provider_message_id = body.get("id") if isinstance(body, dict) else None
        if not provider_message_id or not str(provider_message_id).strip():
            raise ReminderDeliveryError(
                error_code="digest_provider_missing_id",
                retryable=False,
            )

        return ReminderSendResult(provider_message_id=str(provider_message_id))


class ReminderWorkerService:
    def __init__(
        self,
        *,
        settings: Settings,
        reminder_delivery_service: ResendReminderService,
    ) -> None:
        self.settings = settings
        self.reminder_delivery_service = reminder_delivery_service

    async def run_due_work(self, *, mode: DigestMode) -> ReminderRunSummary:
        now_utc = datetime.now(timezone.utc)
        summary = ReminderRunSummary(mode=mode)

        with connection_scope(self.settings.database_url) as connection:
            summary.captures_deleted = delete_expired_captures(
                connection,
                now=now_utc,
                limit=self.settings.reminder_batch_size,
            )
            users = list_users(connection)

        self.reminder_delivery_service.ensure_configured()

        period = self._resolve_period(mode=mode, now_utc=now_utc)
        summary.users_processed = len(users)

        for user in users:
            outcome = await self._process_user_digest(
                mode=mode,
                period=period,
                user=user,
                now_utc=now_utc,
            )
            if outcome == "sent":
                summary.sent += 1
            elif outcome == "skipped_empty":
                summary.skipped_empty += 1
            elif outcome == "failed":
                summary.failed += 1

        return summary

    async def _process_user_digest(
        self,
        *,
        mode: DigestMode,
        period: DigestPeriod,
        user: UserRecord,
        now_utc: datetime,
    ) -> Literal["sent", "failed", "skipped_empty", "already_processed"]:
        idempotency_key = (
            f"digest:{mode}:user:{user.id}:"
            f"start:{period.start_date.isoformat()}:end:{period.end_date.isoformat()}"
        )

        with connection_scope(self.settings.database_url) as connection:
            existing = get_digest_dispatch(
                connection,
                user_id=user.id,
                digest_type=mode,
                period_start_date=period.start_date,
                period_end_date=period.end_date,
            )
        if existing is not None and existing.status in {"sent", "skipped_empty"}:
            return "already_processed"

        if mode == "daily":
            with connection_scope(self.settings.database_url) as connection:
                due_today = list_open_tasks_due_on_date(
                    connection,
                    user_id=user.id,
                    due_date=period.start_date,
                )
                overdue = list_open_tasks_overdue_before_date(
                    connection,
                    user_id=user.id,
                    due_date=period.start_date,
                )

            if not due_today and not overdue:
                self._upsert_dispatch(
                    user=user,
                    mode=mode,
                    period=period,
                    status="skipped_empty",
                    idempotency_key=idempotency_key,
                    attempted_at=now_utc,
                    provider_message_id=None,
                    last_error_code=None,
                )
                return "skipped_empty"

            subject = f"Gust Daily Brief - {period.start_date.isoformat()} (Eastern)"
            text_body = self._build_daily_text_body(
                user=user,
                period=period,
                due_today=due_today,
                overdue=overdue,
            )
            html_body = self._build_daily_html_body(
                user=user,
                period=period,
                due_today=due_today,
                overdue=overdue,
            )
        else:
            assert period.completed_start_utc is not None
            assert period.completed_end_utc is not None

            with connection_scope(self.settings.database_url) as connection:
                completed = list_completed_tasks_between(
                    connection,
                    user_id=user.id,
                    completed_start=period.completed_start_utc,
                    completed_end=period.completed_end_utc,
                )
                due_uncompleted = list_open_tasks_due_between_dates(
                    connection,
                    user_id=user.id,
                    due_date_start=period.start_date,
                    due_date_end=period.end_date,
                )

            if not completed and not due_uncompleted:
                self._upsert_dispatch(
                    user=user,
                    mode=mode,
                    period=period,
                    status="skipped_empty",
                    idempotency_key=idempotency_key,
                    attempted_at=now_utc,
                    provider_message_id=None,
                    last_error_code=None,
                )
                return "skipped_empty"

            subject = (
                "Gust Weekly Summary - "
                f"{period.start_date.isoformat()} to {period.end_date.isoformat()} (Eastern)"
            )
            text_body = self._build_weekly_text_body(
                user=user,
                period=period,
                completed=completed,
                due_uncompleted=due_uncompleted,
            )
            html_body = self._build_weekly_html_body(
                user=user,
                period=period,
                completed=completed,
                due_uncompleted=due_uncompleted,
            )

        try:
            result = await self.reminder_delivery_service.send_digest(
                to_email=user.email,
                subject=subject,
                text_body=text_body,
                html_body=html_body,
                idempotency_key=idempotency_key,
            )
        except ReminderDeliveryError as exc:
            logger.warning(
                "digest_delivery_failed",
                extra={
                    "event": "digest_delivery_failed",
                    "user_id": user.id,
                    "digest_type": mode,
                    "error_code": exc.error_code,
                },
            )
            self._upsert_dispatch(
                user=user,
                mode=mode,
                period=period,
                status="failed",
                idempotency_key=idempotency_key,
                attempted_at=now_utc,
                provider_message_id=None,
                last_error_code=exc.error_code,
            )
            return "failed"

        self._upsert_dispatch(
            user=user,
            mode=mode,
            period=period,
            status="sent",
            idempotency_key=idempotency_key,
            attempted_at=now_utc,
            provider_message_id=result.provider_message_id,
            last_error_code=None,
        )
        logger.info(
            "digest_sent",
            extra={
                "event": "digest_sent",
                "user_id": user.id,
                "digest_type": mode,
            },
        )
        return "sent"

    def _upsert_dispatch(
        self,
        *,
        user: UserRecord,
        mode: DigestMode,
        period: DigestPeriod,
        status: DigestDispatchStatus,
        idempotency_key: str,
        attempted_at: datetime,
        provider_message_id: str | None,
        last_error_code: str | None,
    ) -> None:
        with connection_scope(self.settings.database_url) as connection:
            upsert_digest_dispatch(
                connection,
                user_id=user.id,
                digest_type=mode,
                period_start_date=period.start_date,
                period_end_date=period.end_date,
                status=status,
                idempotency_key=idempotency_key,
                attempted_at=attempted_at,
                provider_message_id=provider_message_id,
                last_error_code=last_error_code,
            )

    def _resolve_period(self, *, mode: DigestMode, now_utc: datetime) -> DigestPeriod:
        now_local = now_utc.astimezone(DIGEST_TIMEZONE)
        today_local = now_local.date()
        if mode == "daily":
            return DigestPeriod(start_date=today_local, end_date=today_local)

        # Monday-start week in fixed Eastern timezone.
        week_start = today_local - timedelta(days=today_local.weekday())
        week_end = week_start + timedelta(days=6)
        completed_start_local = datetime.combine(week_start, time.min, tzinfo=DIGEST_TIMEZONE)
        completed_end_local = datetime.combine(week_end, time.max, tzinfo=DIGEST_TIMEZONE)
        return DigestPeriod(
            start_date=week_start,
            end_date=week_end,
            completed_start_utc=completed_start_local.astimezone(timezone.utc),
            completed_end_utc=completed_end_local.astimezone(timezone.utc),
        )

    def _build_daily_text_body(
        self,
        *,
        user: UserRecord,
        period: DigestPeriod,
        due_today: list[DigestTaskRecord],
        overdue: list[DigestTaskRecord],
    ) -> str:
        lines = [
            "Gust daily brief",
            f"Date (Eastern): {period.start_date.isoformat()}",
            f"User: {user.email}",
            "",
            "Due today:",
        ]
        lines.extend(self._format_task_lines(due_today, include_completed_at=False))
        lines.append("")
        lines.append("Overdue (still open):")
        lines.extend(self._format_task_lines(overdue, include_completed_at=False))
        if self.settings.frontend_app_url:
            lines.extend(["", f"Open Gust: {self.settings.frontend_app_url.rstrip('/')}/tasks"])
        return "\n".join(lines)

    def _build_weekly_text_body(
        self,
        *,
        user: UserRecord,
        period: DigestPeriod,
        completed: list[DigestTaskRecord],
        due_uncompleted: list[DigestTaskRecord],
    ) -> str:
        lines = [
            "Gust weekly summary",
            (f"Week (Eastern): {period.start_date.isoformat()} to {period.end_date.isoformat()}"),
            f"User: {user.email}",
            "",
            "Completed this week:",
        ]
        lines.extend(self._format_task_lines(completed, include_completed_at=True))
        lines.append("")
        lines.append("Due this week and not completed:")
        lines.extend(self._format_task_lines(due_uncompleted, include_completed_at=False))
        if self.settings.frontend_app_url:
            lines.extend(["", f"Open Gust: {self.settings.frontend_app_url.rstrip('/')}/tasks"])
        return "\n".join(lines)

    def _build_daily_html_body(
        self,
        *,
        user: UserRecord,
        period: DigestPeriod,
        due_today: list[DigestTaskRecord],
        overdue: list[DigestTaskRecord],
    ) -> str:
        body = [
            "<p>Gust daily brief</p>",
            f"<p><strong>Date (Eastern):</strong> {period.start_date.isoformat()}</p>",
            f"<p><strong>User:</strong> {html.escape(user.email)}</p>",
            "<h3>Due today</h3>",
            self._format_task_html_list(due_today, include_completed_at=False),
            "<h3>Overdue (still open)</h3>",
            self._format_task_html_list(overdue, include_completed_at=False),
        ]
        if self.settings.frontend_app_url:
            tasks_url = f"{self.settings.frontend_app_url.rstrip('/')}/tasks"
            body.append(f'<p><a href="{tasks_url}">Open Gust</a></p>')
        return "".join(body)

    def _build_weekly_html_body(
        self,
        *,
        user: UserRecord,
        period: DigestPeriod,
        completed: list[DigestTaskRecord],
        due_uncompleted: list[DigestTaskRecord],
    ) -> str:
        body = [
            "<p>Gust weekly summary</p>",
            (
                "<p><strong>Week (Eastern):</strong> "
                f"{period.start_date.isoformat()} to {period.end_date.isoformat()}</p>"
            ),
            f"<p><strong>User:</strong> {html.escape(user.email)}</p>",
            "<h3>Completed this week</h3>",
            self._format_task_html_list(completed, include_completed_at=True),
            "<h3>Due this week and not completed</h3>",
            self._format_task_html_list(due_uncompleted, include_completed_at=False),
        ]
        if self.settings.frontend_app_url:
            tasks_url = f"{self.settings.frontend_app_url.rstrip('/')}/tasks"
            body.append(f'<p><a href="{tasks_url}">Open Gust</a></p>')
        return "".join(body)

    def _format_task_lines(
        self,
        tasks: list[DigestTaskRecord],
        *,
        include_completed_at: bool,
    ) -> list[str]:
        if not tasks:
            return ["- None"]

        lines: list[str] = []
        for task in tasks:
            detail_parts = [
                f"group: {task.group_name}",
                f"due: {task.due_date.isoformat() if task.due_date else 'none'}",
                f"recurrence: {self._format_recurrence(task)}",
            ]
            if include_completed_at and task.completed_at is not None:
                completed_local = task.completed_at.astimezone(DIGEST_TIMEZONE)
                detail_parts.append(f"completed: {completed_local.strftime('%Y-%m-%d %H:%M %Z')}")
            lines.append(f"- {task.title} ({'; '.join(detail_parts)})")
        return lines

    def _format_task_html_list(
        self,
        tasks: list[DigestTaskRecord],
        *,
        include_completed_at: bool,
    ) -> str:
        if not tasks:
            return "<p>None</p>"

        items: list[str] = []
        for task in tasks:
            detail_parts = [
                f"group: {html.escape(task.group_name)}",
                f"due: {task.due_date.isoformat() if task.due_date else 'none'}",
                f"recurrence: {html.escape(self._format_recurrence(task))}",
            ]
            if include_completed_at and task.completed_at is not None:
                completed_local = task.completed_at.astimezone(DIGEST_TIMEZONE)
                detail_parts.append(f"completed: {completed_local.strftime('%Y-%m-%d %H:%M %Z')}")
            escaped_title = html.escape(task.title)
            items.append(f"<li><strong>{escaped_title}</strong> ({'; '.join(detail_parts)})</li>")
        return f"<ul>{''.join(items)}</ul>"

    def _format_recurrence(self, task: DigestTaskRecord) -> str:
        if task.recurrence_frequency is None:
            return "none"
        if task.recurrence_frequency == "daily":
            return "daily"
        if task.recurrence_frequency == "weekly":
            if task.recurrence_weekday is None:
                return "weekly"
            weekday_names = [
                "Sunday",
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
            ]
            return f"weekly ({weekday_names[task.recurrence_weekday]})"
        if task.recurrence_frequency == "monthly":
            if task.recurrence_day_of_month is None:
                return "monthly"
            return f"monthly (day {task.recurrence_day_of_month})"
        return task.recurrence_frequency
