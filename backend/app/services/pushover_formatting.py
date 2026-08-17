from __future__ import annotations

import html
from collections.abc import Sequence
from datetime import date, datetime
from typing import Protocol
from zoneinfo import ZoneInfo

from app.db.repositories import DigestTaskRecord, SubtaskRecord, TaskRecord
from app.services.pushover import PUSHOVER_MESSAGE_MAX_CHARS

GUST_PURPLE = "#A684FF"
DIVIDER = "────────────"
MONTH_NAMES = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)
MONTH_ABBREVIATIONS = tuple(month[:3] for month in MONTH_NAMES)
WEEKDAY_NAMES = (
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
)
EASTERN_TIMEZONE = ZoneInfo("America/New_York")


class RecurrenceFields(Protocol):
    recurrence_frequency: str | None
    recurrence_weekday: int | None
    recurrence_day_of_month: int | None


def _escape_bounded(value: str, limit: int) -> str:
    normalized = " ".join(value.split())
    escaped_parts: list[str] = []
    used = 0
    truncated = False
    for character in normalized:
        escaped = html.escape(character)
        if used + len(escaped) > limit - 1:
            truncated = True
            break
        escaped_parts.append(escaped)
        used += len(escaped)
    if truncated:
        escaped_parts.append("…")
    return "".join(escaped_parts)


def _heading(value: str) -> str:
    return f'<font color="{GUST_PURPLE}"><b>{html.escape(value)}</b></font>'


def _bold_bounded(value: str, limit: int) -> str:
    return f"<b>{_escape_bounded(value, limit)}</b>"


def _friendly_date(value: date, *, include_year: bool = True) -> str:
    result = f"{MONTH_ABBREVIATIONS[value.month - 1]} {value.day}"
    return f"{result}, {value.year}" if include_year else result


def _friendly_datetime(value: datetime, timezone: str) -> str:
    local = value.astimezone(ZoneInfo(timezone))
    clock = local.strftime("%I:%M %p").lstrip("0")
    return f"{_friendly_date(local.date())} at {clock}"


def _friendly_period(start: date, end: date) -> str:
    if start == end:
        return f"{start.strftime('%A')}, {_friendly_date(start, include_year=False)}"
    if start.year == end.year and start.month == end.month:
        return f"{MONTH_ABBREVIATIONS[start.month - 1]} {start.day}–{end.day}, {end.year}"
    return f"{_friendly_date(start)}–{_friendly_date(end)}"


def format_recurrence(task: RecurrenceFields) -> str:
    frequency = task.recurrence_frequency
    interval = getattr(task, "recurrence_interval", None) or 1
    if frequency is None:
        return "One-off"
    if frequency == "daily":
        return "Daily" if interval == 1 else f"Every {interval} days"
    if frequency == "weekly":
        weekday = task.recurrence_weekday
        label = WEEKDAY_NAMES[weekday] if weekday is not None and 0 <= weekday < 7 else None
        if interval == 1:
            return f"Weekly on {label}" if label else "Weekly"
        return f"Every {interval} weeks on {label}" if label else f"Every {interval} weeks"
    if frequency == "monthly":
        day = task.recurrence_day_of_month
        if interval == 1:
            return f"Monthly on day {day}" if day else "Monthly"
        return f"Every {interval} months on day {day}" if day else f"Every {interval} months"
    if frequency == "yearly":
        month = getattr(task, "recurrence_month", None)
        day = task.recurrence_day_of_month
        if month is not None and 1 <= month <= 12 and day is not None:
            return f"Yearly on {MONTH_NAMES[month - 1]} {day}"
        return "Yearly"
    return frequency.capitalize()


def _task_reminder_value(task: TaskRecord, timezone: str) -> str:
    if task.reminder_at is not None:
        return _friendly_datetime(task.reminder_at, timezone)
    if task.reminder_date is not None:
        return _friendly_date(task.reminder_date)
    return "No reminder"


def _field(label: str, value: str, *, value_limit: int) -> str:
    return f"{_heading(label)}\n{_escape_bounded(value, value_limit)}"


def build_task_reminder_message(
    *,
    task: TaskRecord,
    group_name: str,
    subtasks: Sequence[SubtaskRecord],
    timezone: str,
) -> str:
    completed_count = sum(1 for subtask in subtasks if subtask.is_completed)
    subtask_summary = (
        f"{completed_count} of {len(subtasks)} done" if subtasks else "No subtasks yet."
    )
    base_parts = [
        (
            f"{_heading('TASK PREVIEW')}  •  "
            f"{_bold_bounded(task.status.upper(), 12)}  •  "
            f"{_bold_bounded(group_name.upper(), 40)}"
        ),
        _bold_bounded(task.title, 140),
        _field("CONTEXT", task.description or "No description yet.", value_limit=160),
        _field(
            "DUE DATE",
            _friendly_date(task.due_date) if task.due_date else "No due date",
            value_limit=32,
        ),
        _field("REMINDER", _task_reminder_value(task, timezone), value_limit=52),
        _field("RECURRENCE", format_recurrence(task), value_limit=72),
        _field("SUBTASKS", subtask_summary, value_limit=32),
    ]
    message = "\n\n".join(base_parts)
    if not subtasks:
        return message

    rendered_items: list[str] = []
    for index, subtask in enumerate(subtasks):
        marker = "✓" if subtask.is_completed else "○"
        item = f"{marker} {_escape_bounded(subtask.title, 88)}"
        remaining = len(subtasks) - index - 1
        candidate_items = [*rendered_items, item]
        candidate = f"{message}\n" + "\n".join(candidate_items)
        suffix = f"\n…and {remaining} more subtasks" if remaining else ""
        if len(candidate + suffix) > PUSHOVER_MESSAGE_MAX_CHARS:
            omitted = len(subtasks) - len(rendered_items)
            overflow = f"…and {omitted} more subtasks"
            return f"{message}\n" + "\n".join([*rendered_items, overflow])
        rendered_items = candidate_items
    return f"{message}\n" + "\n".join(rendered_items)


def _digest_task_block(
    task: DigestTaskRecord,
    *,
    completed: bool = False,
    include_due_date: bool = True,
) -> str:
    metadata = [_escape_bounded(task.group_name, 42), html.escape(format_recurrence(task))]
    if include_due_date and task.due_date is not None:
        metadata.append(f"Due {_friendly_date(task.due_date, include_year=False)}")
    if completed and task.completed_at is not None:
        completed_date = task.completed_at.astimezone(EASTERN_TIMEZONE).date()
        metadata.append(f"Completed {_friendly_date(completed_date, include_year=False)}")
    return f"{_bold_bounded(task.title, 110)}\n{' • '.join(metadata)}"


def _build_digest_message(
    *,
    heading: str,
    period_label: str,
    sections: Sequence[tuple[str, Sequence[DigestTaskRecord], bool, bool]],
) -> str:
    parts = [_heading(heading), html.escape(period_label)]
    total_tasks = sum(len(tasks) for _, tasks, _, _ in sections)
    rendered_tasks = 0

    for section_title, tasks, completed, include_due_date in sections:
        if not tasks:
            continue
        section_prefix = [DIVIDER, _heading(f"{section_title} · {len(tasks)}")]
        section_started = False
        for task in tasks:
            task_block = _digest_task_block(
                task,
                completed=completed,
                include_due_date=include_due_date,
            )
            additions = [*section_prefix, task_block] if not section_started else [task_block]
            candidate_parts = [*parts, *additions]
            remaining = total_tasks - rendered_tasks - 1
            suffix = f"\n\n…and {remaining} more tasks" if remaining else ""
            candidate = "\n\n".join(candidate_parts)
            if len(candidate + suffix) > PUSHOVER_MESSAGE_MAX_CHARS:
                omitted = total_tasks - rendered_tasks
                return "\n\n".join([*parts, f"…and {omitted} more tasks"])
            parts = candidate_parts
            section_started = True
            rendered_tasks += 1
    return "\n\n".join(parts)


def build_daily_digest_message(
    *,
    digest_date: date,
    due_today: Sequence[DigestTaskRecord],
    overdue: Sequence[DigestTaskRecord],
    undated_open: Sequence[DigestTaskRecord],
) -> str:
    return _build_digest_message(
        heading="DAILY BRIEF",
        period_label=_friendly_period(digest_date, digest_date),
        sections=(
            ("DUE TODAY", due_today, False, True),
            ("OVERDUE", overdue, False, True),
            ("NO DUE DATE", undated_open, False, False),
        ),
    )


def build_weekly_digest_message(
    *,
    start_date: date,
    end_date: date,
    completed: Sequence[DigestTaskRecord],
    due_uncompleted: Sequence[DigestTaskRecord],
    undated_open: Sequence[DigestTaskRecord],
) -> str:
    return _build_digest_message(
        heading="WEEKLY SUMMARY",
        period_label=_friendly_period(start_date, end_date),
        sections=(
            ("COMPLETED", completed, True, True),
            ("DUE AND OPEN", due_uncompleted, False, True),
            ("NO DUE DATE", undated_open, False, False),
        ),
    )
