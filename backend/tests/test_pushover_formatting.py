from __future__ import annotations

import html
import re
from datetime import UTC, date, datetime

from app.db.repositories import DigestTaskRecord, SubtaskRecord, TaskRecord
from app.services.pushover_formatting import (
    PUSHOVER_MESSAGE_MAX_CHARS,
    build_daily_digest_message,
    build_task_reminder_message,
    build_weekly_digest_message,
)


def _task(**overrides) -> TaskRecord:
    values = {
        "id": "11111111-1111-1111-1111-111111111111",
        "user_id": "22222222-2222-2222-2222-222222222222",
        "group_id": "33333333-3333-3333-3333-333333333333",
        "capture_id": None,
        "series_id": None,
        "title": "Look into the Navigator N1.5 model",
        "description": "Compare computer-use capabilities.",
        "status": "open",
        "needs_review": False,
        "due_date": date(2026, 8, 17),
        "reminder_at": datetime(2026, 8, 17, 13, 30, tzinfo=UTC),
        "reminder_date": None,
        "reminder_offset_minutes": 30,
        "recurrence_frequency": None,
        "recurrence_interval": None,
        "recurrence_weekday": None,
        "recurrence_day_of_month": None,
        "recurrence_month": None,
        "completed_at": None,
        "deleted_at": None,
        "created_at": datetime(2026, 8, 1, tzinfo=UTC),
        "updated_at": datetime(2026, 8, 1, tzinfo=UTC),
        "subtask_count": 0,
    }
    values.update(overrides)
    return TaskRecord(**values)


def _subtask(index: int, *, completed: bool = False, title: str | None = None) -> SubtaskRecord:
    now = datetime(2026, 8, 1, tzinfo=UTC)
    return SubtaskRecord(
        id=f"00000000-0000-0000-0000-{index:012d}",
        task_id="11111111-1111-1111-1111-111111111111",
        user_id="22222222-2222-2222-2222-222222222222",
        title=title or f"Checklist item {index}",
        is_completed=completed,
        completed_at=now if completed else None,
        created_at=now,
        updated_at=now,
    )


def _digest_task(index: int, **overrides) -> DigestTaskRecord:
    values = {
        "id": f"00000000-0000-0000-0000-{index:012d}",
        "title": f"Task {index}",
        "due_date": date(2026, 8, 17),
        "completed_at": None,
        "group_name": "Inbox",
        "recurrence_frequency": None,
        "recurrence_weekday": None,
        "recurrence_day_of_month": None,
    }
    values.update(overrides)
    return DigestTaskRecord(**values)


def test_task_reminder_matches_preview_hierarchy_and_escapes_content() -> None:
    task = _task(
        title="Navigator <N1.5>",
        description="Compare A & B",
        recurrence_frequency="yearly",
        recurrence_interval=1,
        recurrence_day_of_month=17,
        recurrence_month=8,
    )

    message = build_task_reminder_message(
        task=task,
        group_name="Research & Development",
        subtasks=[_subtask(1, completed=True), _subtask(2, title="Read <paper>")],
        timezone="America/Toronto",
    )

    assert message.index("TASK PREVIEW") < message.index("Navigator")
    assert message.index("CONTEXT") < message.index("DUE DATE")
    assert message.index("DUE DATE") < message.index("REMINDER")
    assert message.index("REMINDER") < message.index("RECURRENCE")
    assert message.index("RECURRENCE") < message.index("SUBTASKS")
    assert "Navigator &lt;N1.5&gt;" in message
    assert "Compare A &amp; B" in message
    assert "RESEARCH &amp; DEVELOPMENT" in message
    assert "Aug 17, 2026 at 9:30 AM" in message
    assert "Yearly on August 17" in message
    assert "1 of 2 done" in message
    assert "✓ Checklist item 1" in message
    assert "○ Read &lt;paper&gt;" in message
    plain_message = html.unescape(re.sub(r"<[^>]+>", "", message))
    assert "CONTEXT\nCompare A & B\n\nDUE DATE\nAug 17, 2026" in plain_message


def test_task_reminder_formats_date_only_fallbacks() -> None:
    message = build_task_reminder_message(
        task=_task(
            description=None,
            due_date=None,
            reminder_at=None,
            reminder_date=date(2026, 8, 18),
            recurrence_frequency="weekly",
            recurrence_interval=1,
            recurrence_weekday=2,
        ),
        group_name="Inbox",
        subtasks=[],
        timezone="UTC",
    )

    assert "No description yet." in message
    assert "No due date" in message
    assert "Aug 18, 2026" in message
    assert "Weekly on Tuesday" in message
    assert "No subtasks yet." in message


def test_task_reminder_truncates_only_at_complete_subtask_boundaries() -> None:
    subtasks = [_subtask(index, title=f"Subtask {index} " + "x" * 100) for index in range(1, 30)]

    message = build_task_reminder_message(
        task=_task(description="Context " + "y" * 500),
        group_name="Inbox",
        subtasks=subtasks,
        timezone="UTC",
    )

    assert len(message) <= PUSHOVER_MESSAGE_MAX_CHARS
    assert "more subtasks" in message
    assert message.count("<b>") == message.count("</b>")
    assert message.count("<font") == message.count("</font>")
    assert not message.endswith("<")


def test_daily_digest_uses_spaced_nonempty_sections() -> None:
    message = build_daily_digest_message(
        digest_date=date(2026, 8, 17),
        due_today=[_digest_task(1)],
        overdue=[],
        undated_open=[_digest_task(2, due_date=None, title="Unscheduled")],
    )

    assert "DAILY BRIEF" in message
    assert "Monday, Aug 17" in message
    assert "DUE TODAY · 1" in message
    assert "OVERDUE" not in message
    assert "NO DUE DATE · 1" in message
    assert "\n\n" in message
    assert "Due Aug 17" in message
    assert "<b>Unscheduled</b>\nInbox • One-off" in message


def test_weekly_digest_is_bounded_and_reports_omitted_tasks() -> None:
    completed = [
        _digest_task(
            index,
            title=f"Completed task {index} " + "z" * 100,
            completed_at=datetime(2026, 8, 17, 12, tzinfo=UTC),
        )
        for index in range(1, 20)
    ]

    message = build_weekly_digest_message(
        start_date=date(2026, 8, 17),
        end_date=date(2026, 8, 23),
        completed=completed,
        due_uncompleted=[],
        undated_open=[],
    )

    assert len(message) <= PUSHOVER_MESSAGE_MAX_CHARS
    assert "WEEKLY SUMMARY" in message
    assert "COMPLETED · 19" in message
    assert "more tasks" in message
    assert message.count("<b>") == message.count("</b>")
