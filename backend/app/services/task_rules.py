from __future__ import annotations

import calendar
import logging
import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo


@dataclass
class RecurrenceInput:
    frequency: str
    weekday: int | None = None
    day_of_month: int | None = None


@dataclass
class NormalizedTaskFields:
    title: str
    due_date: date | None
    reminder_at: datetime | None
    reminder_offset_minutes: int | None
    recurrence_frequency: str | None
    recurrence_interval: int | None
    recurrence_weekday: int | None
    recurrence_day_of_month: int | None
    series_id: str | None


def normalize_task_fields(
    *,
    title: str,
    due_date: date | None,
    reminder_at: datetime | None,
    recurrence: RecurrenceInput | None,
    user_timezone: str,
    current_series_id: str | None = None,
    # Explicit opt-in behavior flags (default False = strict validation)
    assume_utc_for_naive: bool = False,
    default_due_date_for_recurrence: bool = False,
) -> NormalizedTaskFields:
    normalized_title = title.strip()
    if not normalized_title:
        raise ValueError("Task title cannot be blank.")

    # Handle naive datetime: either assume UTC (opt-in) or raise error (strict)
    if reminder_at is not None and reminder_at.tzinfo is None:
        if assume_utc_for_naive:
            logger = logging.getLogger("gust.api")
            logger.warning(
                "normalization_assuming_utc_for_naive_datetime",
                extra={
                    "event": "normalization_assuming_utc_for_naive_datetime",
                    "original_reminder_at": str(reminder_at),
                    "title": normalized_title,
                },
            )
            reminder_at = reminder_at.replace(tzinfo=ZoneInfo("UTC"))
        else:
            raise ValueError("Reminder timestamp must include a timezone.")

    if due_date is None and reminder_at is not None:
        raise ValueError("Reminder requires a due date.")

    # For weekly/monthly recurrence: either default to today (opt-in) or raise error (strict)
    if due_date is None and recurrence is not None and recurrence.frequency != "daily":
        if default_due_date_for_recurrence:
            logger = logging.getLogger("gust.api")
            logger.warning(
                "normalization_defaulting_due_date_for_recurrence",
                extra={
                    "event": "normalization_defaulting_due_date_for_recurrence",
                    "recurrence_frequency": recurrence.frequency,
                    "title": normalized_title,
                },
            )
            due_date = date.today()
        else:
            raise ValueError("Recurrence requires a due date.")

    recurrence_frequency = None
    recurrence_interval = None
    recurrence_weekday = None
    recurrence_day_of_month = None
    series_id = None
    if recurrence is not None:
        validate_recurrence(recurrence)
        recurrence_frequency = recurrence.frequency
        recurrence_interval = 1
        recurrence_weekday = recurrence.weekday
        recurrence_day_of_month = recurrence.day_of_month
        series_id = current_series_id or str(uuid.uuid4())

    reminder_offset_minutes = None
    if reminder_at is not None and due_date is not None:
        reminder_offset_minutes = compute_reminder_offset_minutes(
            due_date=due_date,
            reminder_at=reminder_at,
            user_timezone=user_timezone,
        )

    return NormalizedTaskFields(
        title=normalized_title,
        due_date=due_date,
        reminder_at=reminder_at,
        reminder_offset_minutes=reminder_offset_minutes,
        recurrence_frequency=recurrence_frequency,
        recurrence_interval=recurrence_interval,
        recurrence_weekday=recurrence_weekday,
        recurrence_day_of_month=recurrence_day_of_month,
        series_id=series_id,
    )


def validate_recurrence(recurrence: RecurrenceInput) -> None:
    if recurrence.frequency == "daily":
        if recurrence.weekday is None and recurrence.day_of_month is None:
            return
    elif recurrence.frequency == "weekly":
        if recurrence.weekday is not None and 0 <= recurrence.weekday <= 6:
            if recurrence.day_of_month is None:
                return
    elif recurrence.frequency == "monthly":
        if recurrence.day_of_month is not None and 1 <= recurrence.day_of_month <= 31:
            if recurrence.weekday is None:
                return

    raise ValueError("Recurrence payload is invalid for v1.")


def compute_reminder_offset_minutes(
    *,
    due_date: date,
    reminder_at: datetime,
    user_timezone: str,
) -> int:
    local_timezone = ZoneInfo(user_timezone)
    due_midnight = datetime.combine(due_date, time.min, tzinfo=local_timezone)
    reminder_local = reminder_at.astimezone(local_timezone)
    delta = reminder_local - due_midnight
    return int(delta.total_seconds() // 60)


def compute_reminder_at_from_offset(
    *,
    due_date: date,
    reminder_offset_minutes: int,
    user_timezone: str,
) -> datetime:
    local_timezone = ZoneInfo(user_timezone)
    due_midnight = datetime.combine(due_date, time.min, tzinfo=local_timezone)
    return due_midnight + timedelta(minutes=reminder_offset_minutes)


def next_due_date_for_completed_task(
    *,
    completed_at: datetime,
    recurrence_frequency: str,
    recurrence_weekday: int | None,
    recurrence_day_of_month: int | None,
    user_timezone: str,
) -> tuple[date, int | None]:
    local_completed_date = completed_at.astimezone(ZoneInfo(user_timezone)).date()

    if recurrence_frequency == "daily":
        return (local_completed_date + timedelta(days=1), recurrence_day_of_month)

    if recurrence_frequency == "weekly":
        if recurrence_weekday is None:
            raise ValueError("Weekly recurrence requires a weekday.")
        days_until = (recurrence_weekday - _weekday_for_v1(local_completed_date)) % 7
        if days_until == 0:
            days_until = 7
        return (local_completed_date + timedelta(days=days_until), recurrence_day_of_month)

    if recurrence_frequency == "monthly":
        next_month = _add_one_month(local_completed_date)
        return (next_month, next_month.day)

    raise ValueError("Unsupported recurrence frequency.")


def due_bucket_for_date(
    *,
    due_date: date | None,
    user_timezone: str,
    now: datetime | None = None,
) -> str:
    if due_date is None:
        return "no_date"

    reference = now or datetime.now(ZoneInfo(user_timezone))
    today = reference.date()
    if due_date < today:
        return "overdue"
    if due_date <= today + timedelta(days=3):
        return "due_soon"
    return "future"


def _weekday_for_v1(value: date) -> int:
    return (value.weekday() + 1) % 7


def _add_one_month(value: date) -> date:
    year = value.year + (1 if value.month == 12 else 0)
    month = 1 if value.month == 12 else value.month + 1
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, min(value.day, last_day))
