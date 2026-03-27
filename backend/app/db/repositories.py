from __future__ import annotations

# ruff: noqa: UP045
import base64
import json
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Literal

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from app.db.schema import (
    captures,
    digest_dispatches,
    extracted_tasks,
    groups,
    reminders,
    subtasks,
    tasks,
    users,
)

CURRENT_TIMESTAMP = sa.text("CURRENT_TIMESTAMP")


@dataclass
class UserRecord:
    id: str
    email: str
    display_name: str | None
    timezone: str


@dataclass
class GroupRecord:
    id: str
    user_id: str
    name: str
    description: str | None
    is_system: bool
    system_key: str | None


@dataclass
class GroupSummaryRecord(GroupRecord):
    open_task_count: int


@dataclass
class GroupContextRecord(GroupRecord):
    recent_task_titles: list[str]


@dataclass
class CaptureRecord:
    id: str
    user_id: str
    input_type: str
    status: str
    source_text: str | None
    transcript_text: str | None
    transcript_edited_text: str | None
    transcription_provider: str | None
    transcription_latency_ms: int | None
    extraction_attempt_count: int
    tasks_created_count: int
    tasks_skipped_count: int
    error_code: str | None
    expires_at: datetime


@dataclass
class TaskRecord:
    id: str
    user_id: str
    group_id: str
    capture_id: str | None
    series_id: str | None
    title: str
    description: str | None
    status: str
    needs_review: bool
    due_date: date | None
    reminder_at: datetime | None
    reminder_offset_minutes: int | None
    recurrence_frequency: str | None
    recurrence_interval: int | None
    recurrence_weekday: int | None
    recurrence_day_of_month: int | None
    completed_at: datetime | None
    deleted_at: datetime | None
    created_at: datetime
    updated_at: datetime
    subtask_count: int = 0


@dataclass
class SubtaskRecord:
    id: str
    task_id: str
    user_id: str
    title: str
    is_completed: bool
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


@dataclass
class ReminderRecord:
    id: str
    user_id: str
    task_id: str
    scheduled_for: datetime
    status: str
    idempotency_key: str
    claim_token: str | None
    claimed_at: datetime | None
    claim_expires_at: datetime | None
    send_attempt_count: int
    last_error_code: str | None
    provider_message_id: str | None
    sent_at: datetime | None
    cancelled_at: datetime | None


@dataclass
class DigestDispatchRecord:
    id: str
    user_id: str
    digest_type: str
    period_start_date: date
    period_end_date: date
    status: str
    idempotency_key: str
    provider_message_id: str | None
    last_error_code: str | None
    attempted_at: datetime | None


@dataclass
class DigestTaskRecord:
    id: str
    title: str
    due_date: date | None
    completed_at: datetime | None
    group_name: str
    recurrence_frequency: str | None
    recurrence_weekday: int | None
    recurrence_day_of_month: int | None


@dataclass
class ExtractedTaskRecord:
    id: str
    user_id: str
    capture_id: str
    title: str
    description: str | None
    group_id: str
    group_name: str | None
    due_date: date | None
    reminder_at: datetime | None
    recurrence_frequency: str | None
    recurrence_weekday: int | None
    recurrence_day_of_month: int | None
    top_confidence: float
    needs_review: bool
    status: str
    subtask_titles: list[str]
    created_at: datetime
    updated_at: datetime


@dataclass
class SessionContext:
    user: UserRecord
    inbox_group_id: str


def _row_to_user(row: sa.Row) -> UserRecord:
    return UserRecord(
        id=str(row.id),
        email=row.email,
        display_name=row.display_name,
        timezone=row.timezone,
    )


def _row_to_group(row: sa.Row) -> GroupRecord:
    return GroupRecord(
        id=str(row.id),
        user_id=str(row.user_id),
        name=row.name,
        description=row.description,
        is_system=bool(row.is_system),
        system_key=row.system_key,
    )


def _row_to_group_summary(row: sa.Row) -> GroupSummaryRecord:
    return GroupSummaryRecord(
        id=str(row.id),
        user_id=str(row.user_id),
        name=row.name,
        description=row.description,
        is_system=bool(row.is_system),
        system_key=row.system_key,
        open_task_count=int(row.open_task_count),
    )


def _row_to_capture(row: sa.Row) -> CaptureRecord:
    return CaptureRecord(
        id=str(row.id),
        user_id=str(row.user_id),
        input_type=row.input_type,
        status=row.status,
        source_text=row.source_text,
        transcript_text=row.transcript_text,
        transcript_edited_text=row.transcript_edited_text,
        transcription_provider=row.transcription_provider,
        transcription_latency_ms=row.transcription_latency_ms,
        extraction_attempt_count=int(row.extraction_attempt_count),
        tasks_created_count=int(row.tasks_created_count),
        tasks_skipped_count=int(row.tasks_skipped_count),
        error_code=row.error_code,
        expires_at=row.expires_at,
    )


def _row_to_task(row: sa.Row) -> TaskRecord:
    return TaskRecord(
        id=str(row.id),
        user_id=str(row.user_id),
        group_id=str(row.group_id),
        capture_id=str(row.capture_id) if row.capture_id is not None else None,
        series_id=str(row.series_id) if row.series_id is not None else None,
        title=row.title,
        description=row.description,
        status=row.status,
        needs_review=bool(row.needs_review),
        due_date=row.due_date,
        reminder_at=row.reminder_at,
        reminder_offset_minutes=row.reminder_offset_minutes,
        recurrence_frequency=row.recurrence_frequency,
        recurrence_interval=row.recurrence_interval,
        recurrence_weekday=row.recurrence_weekday,
        recurrence_day_of_month=row.recurrence_day_of_month,
        completed_at=row.completed_at,
        deleted_at=row.deleted_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
        subtask_count=int(row.subtask_count)
        if hasattr(row, "subtask_count") and row.subtask_count is not None
        else 0,
    )


def _row_to_subtask(row: sa.Row) -> SubtaskRecord:
    return SubtaskRecord(
        id=str(row.id),
        task_id=str(row.task_id),
        user_id=str(row.user_id),
        title=row.title,
        is_completed=bool(row.is_completed),
        completed_at=row.completed_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _row_to_reminder(row: sa.Row) -> ReminderRecord:
    return ReminderRecord(
        id=str(row.id),
        user_id=str(row.user_id),
        task_id=str(row.task_id),
        scheduled_for=row.scheduled_for,
        status=row.status,
        idempotency_key=row.idempotency_key,
        claim_token=str(row.claim_token) if row.claim_token is not None else None,
        claimed_at=row.claimed_at,
        claim_expires_at=row.claim_expires_at,
        send_attempt_count=int(row.send_attempt_count),
        last_error_code=row.last_error_code,
        provider_message_id=row.provider_message_id,
        sent_at=row.sent_at,
        cancelled_at=row.cancelled_at,
    )


def _row_to_digest_dispatch(row: sa.Row) -> DigestDispatchRecord:
    return DigestDispatchRecord(
        id=str(row.id),
        user_id=str(row.user_id),
        digest_type=row.digest_type,
        period_start_date=row.period_start_date,
        period_end_date=row.period_end_date,
        status=row.status,
        idempotency_key=row.idempotency_key,
        provider_message_id=row.provider_message_id,
        last_error_code=row.last_error_code,
        attempted_at=row.attempted_at,
    )


def _row_to_digest_task(row: sa.Row) -> DigestTaskRecord:
    return DigestTaskRecord(
        id=str(row.id),
        title=row.title,
        due_date=row.due_date,
        completed_at=row.completed_at,
        group_name=row.group_name,
        recurrence_frequency=row.recurrence_frequency,
        recurrence_weekday=row.recurrence_weekday,
        recurrence_day_of_month=row.recurrence_day_of_month,
    )


def _row_to_extracted_task(row: sa.Row) -> ExtractedTaskRecord:
    raw_subtasks = row.subtask_titles
    if isinstance(raw_subtasks, list):
        subtask_titles = [str(t) for t in raw_subtasks]
    else:
        subtask_titles = []
    return ExtractedTaskRecord(
        id=str(row.id),
        user_id=str(row.user_id),
        capture_id=str(row.capture_id),
        title=row.title,
        description=row.description,
        group_id=str(row.group_id),
        group_name=row.group_name,
        due_date=row.due_date,
        reminder_at=row.reminder_at,
        recurrence_frequency=row.recurrence_frequency,
        recurrence_weekday=row.recurrence_weekday,
        recurrence_day_of_month=row.recurrence_day_of_month,
        top_confidence=float(row.top_confidence),
        needs_review=bool(row.needs_review),
        status=row.status,
        subtask_titles=subtask_titles,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def upsert_user(
    connection: Connection,
    *,
    user_id: str,
    email: str,
    display_name: str | None,
    timezone: str,
) -> UserRecord:
    dialect_name = connection.dialect.name
    values = {
        "id": user_id,
        "email": email,
        "display_name": display_name,
        "timezone": timezone,
    }

    if dialect_name == "sqlite":
        insert_stmt = sa.dialects.sqlite.insert(users).values(**values)
        statement = insert_stmt.on_conflict_do_update(
            index_elements=[users.c.id],
            set_={
                "email": email,
                "display_name": display_name,
                "timezone": timezone,
                "updated_at": CURRENT_TIMESTAMP,
            },
        )
    else:
        insert_stmt = sa.dialects.postgresql.insert(users).values(**values)
        statement = insert_stmt.on_conflict_do_update(
            index_elements=[users.c.id],
            set_={
                "email": email,
                "display_name": display_name,
                "timezone": timezone,
                "updated_at": CURRENT_TIMESTAMP,
            },
        )

    connection.execute(statement)
    row = connection.execute(sa.select(users).where(users.c.id == user_id)).one()
    return _row_to_user(row)


def get_user(connection: Connection, user_id: str) -> UserRecord | None:
    row = connection.execute(sa.select(users).where(users.c.id == user_id)).first()
    if row is None:
        return None
    return _row_to_user(row)


def list_users(connection: Connection) -> list[UserRecord]:
    rows = connection.execute(
        sa.select(users)
        .where(users.c.email.is_not(None))
        .order_by(users.c.created_at.asc(), users.c.id.asc())
    ).fetchall()
    return [_row_to_user(row) for row in rows]


def list_open_tasks_due_on_date(
    connection: Connection,
    *,
    user_id: str,
    due_date: date,
) -> list[DigestTaskRecord]:
    rows = connection.execute(
        sa.select(
            tasks.c.id,
            tasks.c.title,
            tasks.c.due_date,
            tasks.c.completed_at,
            groups.c.name.label("group_name"),
            tasks.c.recurrence_frequency,
            tasks.c.recurrence_weekday,
            tasks.c.recurrence_day_of_month,
        )
        .select_from(tasks.join(groups, groups.c.id == tasks.c.group_id))
        .where(
            tasks.c.user_id == user_id,
            tasks.c.status == "open",
            tasks.c.deleted_at.is_(None),
            tasks.c.due_date == due_date,
        )
        .order_by(sa.func.lower(groups.c.name), tasks.c.created_at.asc(), tasks.c.id.asc())
    ).fetchall()
    return [_row_to_digest_task(row) for row in rows]


def list_open_tasks_overdue_before_date(
    connection: Connection,
    *,
    user_id: str,
    due_date: date,
) -> list[DigestTaskRecord]:
    rows = connection.execute(
        sa.select(
            tasks.c.id,
            tasks.c.title,
            tasks.c.due_date,
            tasks.c.completed_at,
            groups.c.name.label("group_name"),
            tasks.c.recurrence_frequency,
            tasks.c.recurrence_weekday,
            tasks.c.recurrence_day_of_month,
        )
        .select_from(tasks.join(groups, groups.c.id == tasks.c.group_id))
        .where(
            tasks.c.user_id == user_id,
            tasks.c.status == "open",
            tasks.c.deleted_at.is_(None),
            tasks.c.due_date.is_not(None),
            tasks.c.due_date < due_date,
        )
        .order_by(
            tasks.c.due_date.asc(),
            sa.func.lower(groups.c.name),
            tasks.c.created_at.asc(),
            tasks.c.id.asc(),
        )
    ).fetchall()
    return [_row_to_digest_task(row) for row in rows]


def list_completed_tasks_between(
    connection: Connection,
    *,
    user_id: str,
    completed_start: datetime,
    completed_end: datetime,
) -> list[DigestTaskRecord]:
    rows = connection.execute(
        sa.select(
            tasks.c.id,
            tasks.c.title,
            tasks.c.due_date,
            tasks.c.completed_at,
            groups.c.name.label("group_name"),
            tasks.c.recurrence_frequency,
            tasks.c.recurrence_weekday,
            tasks.c.recurrence_day_of_month,
        )
        .select_from(tasks.join(groups, groups.c.id == tasks.c.group_id))
        .where(
            tasks.c.user_id == user_id,
            tasks.c.status == "completed",
            tasks.c.completed_at.is_not(None),
            tasks.c.completed_at >= completed_start,
            tasks.c.completed_at <= completed_end,
            tasks.c.deleted_at.is_(None),
        )
        .order_by(tasks.c.completed_at.desc(), sa.func.lower(groups.c.name), tasks.c.id.asc())
    ).fetchall()
    return [_row_to_digest_task(row) for row in rows]


def list_open_tasks_due_between_dates(
    connection: Connection,
    *,
    user_id: str,
    due_date_start: date,
    due_date_end: date,
) -> list[DigestTaskRecord]:
    rows = connection.execute(
        sa.select(
            tasks.c.id,
            tasks.c.title,
            tasks.c.due_date,
            tasks.c.completed_at,
            groups.c.name.label("group_name"),
            tasks.c.recurrence_frequency,
            tasks.c.recurrence_weekday,
            tasks.c.recurrence_day_of_month,
        )
        .select_from(tasks.join(groups, groups.c.id == tasks.c.group_id))
        .where(
            tasks.c.user_id == user_id,
            tasks.c.status == "open",
            tasks.c.deleted_at.is_(None),
            tasks.c.due_date.is_not(None),
            tasks.c.due_date >= due_date_start,
            tasks.c.due_date <= due_date_end,
        )
        .order_by(
            tasks.c.due_date.asc(),
            sa.func.lower(groups.c.name),
            tasks.c.created_at.asc(),
            tasks.c.id.asc(),
        )
    ).fetchall()
    return [_row_to_digest_task(row) for row in rows]


def update_user_timezone(
    connection: Connection,
    *,
    user_id: str,
    timezone: str,
) -> UserRecord | None:
    connection.execute(
        users.update()
        .where(users.c.id == user_id)
        .values(timezone=timezone, updated_at=CURRENT_TIMESTAMP)
    )
    return get_user(connection, user_id)


def ensure_inbox_group(connection: Connection, *, user_id: str) -> GroupRecord:
    existing = connection.execute(
        sa.select(groups).where(
            groups.c.user_id == user_id,
            groups.c.system_key == "inbox",
        )
    ).first()
    if existing is None:
        group_id = str(uuid.uuid4())
        connection.execute(
            groups.insert().values(
                id=group_id,
                user_id=user_id,
                name="Inbox",
                description=None,
                is_system=True,
                system_key="inbox",
            )
        )
        existing = connection.execute(sa.select(groups).where(groups.c.id == group_id)).one()

    return _row_to_group(existing)


def get_session_context(connection: Connection, user_id: str) -> SessionContext | None:
    user = get_user(connection, user_id)
    if user is None:
        return None

    inbox_group = ensure_inbox_group(connection, user_id=user_id)
    return SessionContext(user=user, inbox_group_id=inbox_group.id)


def get_group(connection: Connection, *, user_id: str, group_id: str) -> GroupRecord | None:
    row = connection.execute(
        sa.select(groups).where(groups.c.id == group_id, groups.c.user_id == user_id)
    ).first()
    if row is None:
        return None
    return _row_to_group(row)


def list_groups_with_counts(connection: Connection, *, user_id: str) -> list[GroupSummaryRecord]:
    open_task_count = (
        sa.select(
            tasks.c.group_id.label("group_id"),
            sa.func.count(tasks.c.id).label("open_task_count"),
        )
        .where(
            tasks.c.user_id == user_id,
            tasks.c.status == "open",
            tasks.c.deleted_at.is_(None),
        )
        .group_by(tasks.c.group_id)
        .subquery()
    )

    rows = connection.execute(
        sa.select(
            groups,
            sa.func.coalesce(open_task_count.c.open_task_count, 0).label("open_task_count"),
        )
        .outerjoin(open_task_count, open_task_count.c.group_id == groups.c.id)
        .where(groups.c.user_id == user_id)
        .order_by(groups.c.is_system.desc(), sa.func.lower(groups.c.name))
    ).fetchall()
    return [_row_to_group_summary(row) for row in rows]


def create_group(
    connection: Connection,
    *,
    user_id: str,
    name: str,
    description: str | None,
) -> GroupRecord:
    group_id = str(uuid.uuid4())
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
    row = connection.execute(sa.select(groups).where(groups.c.id == group_id)).one()
    return _row_to_group(row)


def update_group(
    connection: Connection,
    *,
    user_id: str,
    group_id: str,
    values: dict[str, object],
) -> GroupRecord | None:
    update_values = {**values, "updated_at": CURRENT_TIMESTAMP}
    connection.execute(
        groups.update()
        .where(groups.c.id == group_id, groups.c.user_id == user_id)
        .values(**update_values)
    )
    return get_group(connection, user_id=user_id, group_id=group_id)


def delete_group(connection: Connection, *, user_id: str, group_id: str) -> None:
    connection.execute(groups.delete().where(groups.c.id == group_id, groups.c.user_id == user_id))


def create_capture(
    connection: Connection,
    *,
    user_id: str,
    input_type: str,
    status: str,
    expires_at: datetime,
    source_text: str | None = None,
    transcript_text: str | None = None,
    transcript_edited_text: str | None = None,
    transcription_provider: str | None = None,
    transcription_latency_ms: int | None = None,
    error_code: str | None = None,
) -> CaptureRecord:
    capture_id = str(uuid.uuid4())
    connection.execute(
        captures.insert().values(
            id=capture_id,
            user_id=user_id,
            input_type=input_type,
            status=status,
            source_text=source_text,
            transcript_text=transcript_text,
            transcript_edited_text=transcript_edited_text,
            transcription_provider=transcription_provider,
            transcription_latency_ms=transcription_latency_ms,
            error_code=error_code,
            expires_at=expires_at,
        )
    )
    row = connection.execute(sa.select(captures).where(captures.c.id == capture_id)).one()
    return _row_to_capture(row)


def get_capture(
    connection: Connection,
    *,
    user_id: str,
    capture_id: str,
) -> CaptureRecord | None:
    row = connection.execute(
        sa.select(captures).where(captures.c.id == capture_id, captures.c.user_id == user_id)
    ).first()
    if row is None:
        return None
    return _row_to_capture(row)


def update_capture(
    connection: Connection,
    *,
    user_id: str,
    capture_id: str,
    status: str | None = None,
    source_text: str | None = None,
    transcript_text: str | None = None,
    transcript_edited_text: str | None = None,
    transcription_provider: str | None = None,
    transcription_latency_ms: int | None = None,
    extraction_attempt_count: int | None = None,
    tasks_created_count: int | None = None,
    tasks_skipped_count: int | None = None,
    error_code: str | None = None,
) -> CaptureRecord | None:
    values: dict[str, object] = {"updated_at": CURRENT_TIMESTAMP, "error_code": error_code}
    if status is not None:
        values["status"] = status
    if source_text is not None:
        values["source_text"] = source_text
    if transcript_text is not None:
        values["transcript_text"] = transcript_text
    if transcript_edited_text is not None:
        values["transcript_edited_text"] = transcript_edited_text
    if transcription_provider is not None:
        values["transcription_provider"] = transcription_provider
    if transcription_latency_ms is not None:
        values["transcription_latency_ms"] = transcription_latency_ms
    if extraction_attempt_count is not None:
        values["extraction_attempt_count"] = extraction_attempt_count
    if tasks_created_count is not None:
        values["tasks_created_count"] = tasks_created_count
    if tasks_skipped_count is not None:
        values["tasks_skipped_count"] = tasks_skipped_count

    connection.execute(
        captures.update()
        .where(captures.c.id == capture_id, captures.c.user_id == user_id)
        .values(**values)
    )
    return get_capture(connection, user_id=user_id, capture_id=capture_id)


def list_groups_with_recent_tasks(
    connection: Connection,
    *,
    user_id: str,
    limit_per_group: int = 5,
) -> list[GroupContextRecord]:
    rows = connection.execute(
        sa.select(groups)
        .where(groups.c.user_id == user_id)
        .order_by(groups.c.is_system.desc(), sa.func.lower(groups.c.name))
    ).fetchall()

    result: list[GroupContextRecord] = []
    for row in rows:
        recent_task_rows = connection.execute(
            sa.select(tasks.c.title)
            .where(
                tasks.c.user_id == user_id,
                tasks.c.group_id == row.id,
                tasks.c.status == "open",
                tasks.c.deleted_at.is_(None),
            )
            .order_by(tasks.c.created_at.desc())
            .limit(limit_per_group)
        ).fetchall()
        result.append(
            GroupContextRecord(
                id=str(row.id),
                user_id=str(row.user_id),
                name=row.name,
                description=row.description,
                is_system=bool(row.is_system),
                system_key=row.system_key,
                recent_task_titles=[task_row.title for task_row in recent_task_rows],
            )
        )
    return result


def get_task(connection: Connection, *, user_id: str, task_id: str) -> TaskRecord | None:
    row = connection.execute(
        sa.select(tasks).where(tasks.c.id == task_id, tasks.c.user_id == user_id)
    ).first()
    if row is None:
        return None
    return _row_to_task(row)


def list_tasks(
    connection: Connection,
    *,
    user_id: str,
    group_id: str | None = None,
    status: str = "open",
    include_deleted: bool = False,
    limit: int = 50,
    cursor: str | None = None,
) -> tuple[list[TaskRecord], bool, str | None]:
    """Returns (tasks, has_more, next_cursor)."""
    conditions = [tasks.c.user_id == user_id, tasks.c.status == status]
    if group_id is not None and group_id != "all":
        conditions.append(tasks.c.group_id == group_id)
    if not include_deleted:
        conditions.append(tasks.c.deleted_at.is_(None))

    # Scalar subquery to count subtasks per task
    subtask_count_subquery = (
        sa.select(sa.func.count(subtasks.c.id))
        .where(subtasks.c.task_id == tasks.c.id)
        .correlate(tasks)
        .scalar_subquery()
        .label("subtask_count")
    )

    # Apply cursor-based pagination if provided
    if cursor:
        try:
            cursor_data = json.loads(base64.b64decode(cursor).decode("utf-8"))
            cursor_created_at = datetime.fromisoformat(cursor_data["created_at"])
            cursor_id = cursor_data["id"]
            # Cursor condition: (created_at, id) < (cursor_created_at, cursor_id)
            # i.e., items that come after the cursor in our DESC order
            cursor_condition = sa.or_(
                tasks.c.created_at < cursor_created_at,
                sa.and_(tasks.c.created_at == cursor_created_at, tasks.c.id < cursor_id),
            )
            conditions.append(cursor_condition)
        except (json.JSONDecodeError, KeyError, ValueError):
            # Invalid cursor, ignore and fetch from beginning
            pass

    # Fetch limit+1 to determine if there are more results
    rows = connection.execute(
        sa.select(tasks, subtask_count_subquery)
        .where(*conditions)
        .order_by(tasks.c.created_at.desc(), tasks.c.id.desc())
        .limit(limit + 1)
    ).fetchall()

    has_more = len(rows) > limit
    if has_more:
        rows = rows[:limit]

    # Generate next cursor from last item
    next_cursor = None
    if has_more and rows:
        last_row = rows[-1]
        cursor_data = {"created_at": last_row.created_at.isoformat(), "id": str(last_row.id)}
        next_cursor = base64.b64encode(json.dumps(cursor_data).encode("utf-8")).decode("utf-8")

    return [_row_to_task(row) for row in rows], has_more, next_cursor


def get_open_task_in_series(
    connection: Connection,
    *,
    user_id: str,
    series_id: str,
    exclude_task_id: str | None = None,
) -> TaskRecord | None:
    conditions = [
        tasks.c.user_id == user_id,
        tasks.c.series_id == series_id,
        tasks.c.status == "open",
        tasks.c.deleted_at.is_(None),
    ]
    if exclude_task_id is not None:
        conditions.append(tasks.c.id != exclude_task_id)
    row = connection.execute(
        sa.select(tasks).where(*conditions).order_by(tasks.c.created_at.desc()).limit(1)
    ).first()
    if row is None:
        return None
    return _row_to_task(row)


def list_open_tasks_in_series(
    connection: Connection,
    *,
    user_id: str,
    series_id: str,
    exclude_task_id: str | None = None,
) -> list[TaskRecord]:
    conditions = [
        tasks.c.user_id == user_id,
        tasks.c.series_id == series_id,
        tasks.c.status == "open",
        tasks.c.deleted_at.is_(None),
    ]
    if exclude_task_id is not None:
        conditions.append(tasks.c.id != exclude_task_id)

    rows = connection.execute(
        sa.select(tasks).where(*conditions).order_by(tasks.c.created_at.desc(), tasks.c.id.desc())
    ).fetchall()
    return [_row_to_task(row) for row in rows]


def create_task(
    connection: Connection,
    *,
    user_id: str,
    group_id: str,
    capture_id: str | None,
    title: str,
    needs_review: bool,
    description: str | None = None,
    due_date: date | None = None,
    reminder_at: datetime | None = None,
    reminder_offset_minutes: int | None = None,
    recurrence_frequency: str | None = None,
    recurrence_interval: int | None = None,
    recurrence_weekday: int | None = None,
    recurrence_day_of_month: int | None = None,
    series_id: str | None = None,
) -> TaskRecord:
    task_id = str(uuid.uuid4())
    connection.execute(
        tasks.insert().values(
            id=task_id,
            user_id=user_id,
            group_id=group_id,
            capture_id=capture_id,
            series_id=series_id,
            title=title,
            description=description,
            status="open",
            needs_review=needs_review,
            due_date=due_date,
            reminder_at=reminder_at,
            reminder_offset_minutes=reminder_offset_minutes,
            recurrence_frequency=recurrence_frequency,
            recurrence_interval=recurrence_interval,
            recurrence_weekday=recurrence_weekday,
            recurrence_day_of_month=recurrence_day_of_month,
        )
    )
    row = connection.execute(sa.select(tasks).where(tasks.c.id == task_id)).one()
    return _row_to_task(row)


def update_task(
    connection: Connection,
    *,
    user_id: str,
    task_id: str,
    values: dict[str, object],
) -> TaskRecord | None:
    update_values = {**values, "updated_at": CURRENT_TIMESTAMP}
    connection.execute(
        tasks.update()
        .where(tasks.c.id == task_id, tasks.c.user_id == user_id)
        .values(**update_values)
    )
    return get_task(connection, user_id=user_id, task_id=task_id)


def complete_task_if_open(
    connection: Connection,
    *,
    user_id: str,
    task_id: str,
    completed_at: datetime,
    series_id: str | None = None,
) -> TaskRecord | None:
    update_values: dict[str, object] = {
        "status": "completed",
        "completed_at": completed_at,
        "updated_at": CURRENT_TIMESTAMP,
    }
    if series_id is not None:
        update_values["series_id"] = series_id
    result = connection.execute(
        tasks.update()
        .where(
            tasks.c.id == task_id,
            tasks.c.user_id == user_id,
            tasks.c.status == "open",
            tasks.c.deleted_at.is_(None),
        )
        .values(**update_values)
    )
    if int(result.rowcount or 0) == 0:
        return None
    return get_task(connection, user_id=user_id, task_id=task_id)


def bulk_reassign_tasks(
    connection: Connection,
    *,
    user_id: str,
    source_group_id: str,
    destination_group_id: str,
) -> None:
    connection.execute(
        tasks.update()
        .where(
            tasks.c.user_id == user_id,
            tasks.c.group_id == source_group_id,
        )
        .values(
            group_id=destination_group_id,
            needs_review=False,
            updated_at=CURRENT_TIMESTAMP,
        )
    )


def list_subtasks(connection: Connection, *, user_id: str, task_id: str) -> list[SubtaskRecord]:
    rows = connection.execute(
        sa.select(subtasks)
        .where(subtasks.c.user_id == user_id, subtasks.c.task_id == task_id)
        .order_by(subtasks.c.created_at.asc(), subtasks.c.id.asc())
    ).fetchall()
    return [_row_to_subtask(row) for row in rows]


def get_subtask(
    connection: Connection,
    *,
    user_id: str,
    task_id: str,
    subtask_id: str,
) -> SubtaskRecord | None:
    row = connection.execute(
        sa.select(subtasks).where(
            subtasks.c.id == subtask_id,
            subtasks.c.user_id == user_id,
            subtasks.c.task_id == task_id,
        )
    ).first()
    if row is None:
        return None
    return _row_to_subtask(row)


def create_subtasks(
    connection: Connection,
    *,
    user_id: str,
    task_id: str,
    titles: list[str],
) -> None:
    for title in titles:
        create_subtask(connection, user_id=user_id, task_id=task_id, title=title)


def create_subtask(
    connection: Connection,
    *,
    user_id: str,
    task_id: str,
    title: str,
) -> SubtaskRecord:
    subtask_id = str(uuid.uuid4())
    connection.execute(
        subtasks.insert().values(
            id=subtask_id,
            task_id=task_id,
            user_id=user_id,
            title=title,
        )
    )
    row = connection.execute(sa.select(subtasks).where(subtasks.c.id == subtask_id)).one()
    return _row_to_subtask(row)


def update_subtask(
    connection: Connection,
    *,
    user_id: str,
    task_id: str,
    subtask_id: str,
    values: dict[str, object],
) -> SubtaskRecord | None:
    update_values = {**values, "updated_at": CURRENT_TIMESTAMP}
    connection.execute(
        subtasks.update()
        .where(
            subtasks.c.id == subtask_id,
            subtasks.c.user_id == user_id,
            subtasks.c.task_id == task_id,
        )
        .values(**update_values)
    )
    return get_subtask(connection, user_id=user_id, task_id=task_id, subtask_id=subtask_id)


def delete_subtask(
    connection: Connection,
    *,
    user_id: str,
    task_id: str,
    subtask_id: str,
) -> None:
    connection.execute(
        subtasks.delete().where(
            subtasks.c.id == subtask_id,
            subtasks.c.user_id == user_id,
            subtasks.c.task_id == task_id,
        )
    )


def get_reminder_by_task_id(
    connection: Connection,
    *,
    user_id: str,
    task_id: str,
) -> ReminderRecord | None:
    row = connection.execute(
        sa.select(reminders).where(reminders.c.user_id == user_id, reminders.c.task_id == task_id)
    ).first()
    if row is None:
        return None
    return _row_to_reminder(row)


def get_reminder_by_id(connection: Connection, *, reminder_id: str) -> ReminderRecord | None:
    row = connection.execute(sa.select(reminders).where(reminders.c.id == reminder_id)).first()
    if row is None:
        return None
    return _row_to_reminder(row)


def get_digest_dispatch(
    connection: Connection,
    *,
    user_id: str,
    digest_type: Literal["daily", "weekly"],
    period_start_date: date,
    period_end_date: date,
) -> DigestDispatchRecord | None:
    row = connection.execute(
        sa.select(digest_dispatches).where(
            digest_dispatches.c.user_id == user_id,
            digest_dispatches.c.digest_type == digest_type,
            digest_dispatches.c.period_start_date == period_start_date,
            digest_dispatches.c.period_end_date == period_end_date,
        )
    ).first()
    if row is None:
        return None
    return _row_to_digest_dispatch(row)


def upsert_digest_dispatch(
    connection: Connection,
    *,
    user_id: str,
    digest_type: Literal["daily", "weekly"],
    period_start_date: date,
    period_end_date: date,
    status: Literal["sent", "failed", "skipped_empty"],
    idempotency_key: str,
    attempted_at: datetime,
    provider_message_id: str | None = None,
    last_error_code: str | None = None,
) -> DigestDispatchRecord:
    digest_dispatch_id = str(uuid.uuid4())
    values = {
        "id": digest_dispatch_id,
        "user_id": user_id,
        "digest_type": digest_type,
        "period_start_date": period_start_date,
        "period_end_date": period_end_date,
        "status": status,
        "idempotency_key": idempotency_key,
        "provider_message_id": provider_message_id,
        "last_error_code": last_error_code,
        "attempted_at": attempted_at,
    }

    if connection.dialect.name == "sqlite":
        insert_stmt = sa.dialects.sqlite.insert(digest_dispatches).values(**values)
    else:
        insert_stmt = sa.dialects.postgresql.insert(digest_dispatches).values(**values)

    statement = insert_stmt.on_conflict_do_update(
        index_elements=[
            digest_dispatches.c.user_id,
            digest_dispatches.c.digest_type,
            digest_dispatches.c.period_start_date,
            digest_dispatches.c.period_end_date,
        ],
        set_={
            "status": status,
            "idempotency_key": idempotency_key,
            "provider_message_id": provider_message_id,
            "last_error_code": last_error_code,
            "attempted_at": attempted_at,
            "updated_at": CURRENT_TIMESTAMP,
        },
    )
    connection.execute(statement)

    row = connection.execute(
        sa.select(digest_dispatches).where(
            digest_dispatches.c.user_id == user_id,
            digest_dispatches.c.digest_type == digest_type,
            digest_dispatches.c.period_start_date == period_start_date,
            digest_dispatches.c.period_end_date == period_end_date,
        )
    ).one()
    return _row_to_digest_dispatch(row)


def create_reminder(
    connection: Connection,
    *,
    user_id: str,
    task_id: str,
    scheduled_for: datetime,
) -> ReminderRecord:
    reminder_id = str(uuid.uuid4())
    idempotency_key = f"task:{task_id}:scheduled:{scheduled_for.isoformat()}"
    connection.execute(
        reminders.insert().values(
            id=reminder_id,
            user_id=user_id,
            task_id=task_id,
            scheduled_for=scheduled_for,
            status="pending",
            idempotency_key=idempotency_key,
        )
    )
    row = connection.execute(sa.select(reminders).where(reminders.c.id == reminder_id)).one()
    return _row_to_reminder(row)


def requeue_expired_claims(
    connection: Connection,
    *,
    now: datetime,
) -> int:
    result = connection.execute(
        reminders.update()
        .where(
            reminders.c.status == "claimed",
            reminders.c.claim_expires_at.is_not(None),
            reminders.c.claim_expires_at <= now,
        )
        .values(
            status="pending",
            claim_token=None,
            claimed_at=None,
            claim_expires_at=None,
            updated_at=CURRENT_TIMESTAMP,
        )
    )
    return int(result.rowcount or 0)


def claim_due_reminders(
    connection: Connection,
    *,
    now: datetime,
    limit: int,
    claim_timeout_seconds: int,
) -> list[ReminderRecord]:
    claim_token = str(uuid.uuid4())
    claim_expires_at = now + timedelta(seconds=claim_timeout_seconds)

    if connection.dialect.name == "postgresql":
        connection.execute(
            sa.text(
                """
                WITH eligible AS (
                    SELECT r.id
                    FROM reminders AS r
                    JOIN tasks AS t
                      ON t.id = r.task_id
                     AND t.user_id = r.user_id
                    WHERE r.status = 'pending'
                      AND r.scheduled_for <= :now
                      AND t.status = 'open'
                      AND t.deleted_at IS NULL
                    ORDER BY r.scheduled_for ASC, r.id ASC
                    FOR UPDATE SKIP LOCKED
                    LIMIT :limit
                )
                UPDATE reminders AS r
                   SET status = 'claimed',
                       claim_token = :claim_token,
                       claimed_at = :now,
                       claim_expires_at = :claim_expires_at,
                       updated_at = CURRENT_TIMESTAMP
                  FROM eligible
                 WHERE r.id = eligible.id
                """
            ),
            {
                "now": now,
                "limit": limit,
                "claim_token": claim_token,
                "claim_expires_at": claim_expires_at,
            },
        )
    else:
        candidate_rows = connection.execute(
            sa.select(reminders.c.id)
            .select_from(reminders.join(tasks, tasks.c.id == reminders.c.task_id))
            .where(
                reminders.c.status == "pending",
                reminders.c.scheduled_for <= now,
                tasks.c.status == "open",
                tasks.c.deleted_at.is_(None),
            )
            .order_by(reminders.c.scheduled_for.asc(), reminders.c.id.asc())
            .limit(limit)
        ).fetchall()
        candidate_ids = [str(row.id) for row in candidate_rows]
        if not candidate_ids:
            return []
        connection.execute(
            reminders.update()
            .where(reminders.c.id.in_(candidate_ids), reminders.c.status == "pending")
            .values(
                status="claimed",
                claim_token=claim_token,
                claimed_at=now,
                claim_expires_at=claim_expires_at,
                updated_at=CURRENT_TIMESTAMP,
            )
        )

    rows = connection.execute(
        sa.select(reminders)
        .where(reminders.c.claim_token == claim_token)
        .order_by(reminders.c.scheduled_for.asc(), reminders.c.id.asc())
    ).fetchall()
    return [_row_to_reminder(row) for row in rows]


def cancel_claimed_reminder(
    connection: Connection,
    *,
    reminder_id: str,
    claim_token: str,
) -> ReminderRecord | None:
    connection.execute(
        reminders.update()
        .where(
            reminders.c.id == reminder_id,
            reminders.c.status == "claimed",
            reminders.c.claim_token == claim_token,
        )
        .values(
            status="cancelled",
            claim_token=None,
            claimed_at=None,
            claim_expires_at=None,
            last_error_code=None,
            cancelled_at=CURRENT_TIMESTAMP,
            updated_at=CURRENT_TIMESTAMP,
        )
    )
    return get_reminder_by_id(connection, reminder_id=reminder_id)


def mark_reminder_sent(
    connection: Connection,
    *,
    reminder_id: str,
    claim_token: str,
    provider_message_id: str,
    sent_at: datetime,
) -> ReminderRecord | None:
    connection.execute(
        reminders.update()
        .where(
            reminders.c.id == reminder_id,
            reminders.c.status == "claimed",
            reminders.c.claim_token == claim_token,
        )
        .values(
            status="sent",
            claim_token=None,
            claimed_at=None,
            claim_expires_at=None,
            send_attempt_count=reminders.c.send_attempt_count + 1,
            last_error_code=None,
            provider_message_id=provider_message_id,
            sent_at=sent_at,
            updated_at=CURRENT_TIMESTAMP,
        )
    )
    return get_reminder_by_id(connection, reminder_id=reminder_id)


def requeue_claimed_reminder(
    connection: Connection,
    *,
    reminder_id: str,
    claim_token: str,
    error_code: str,
) -> ReminderRecord | None:
    connection.execute(
        reminders.update()
        .where(
            reminders.c.id == reminder_id,
            reminders.c.status == "claimed",
            reminders.c.claim_token == claim_token,
        )
        .values(
            status="pending",
            claim_token=None,
            claimed_at=None,
            claim_expires_at=None,
            send_attempt_count=reminders.c.send_attempt_count + 1,
            last_error_code=error_code,
            updated_at=CURRENT_TIMESTAMP,
        )
    )
    return get_reminder_by_id(connection, reminder_id=reminder_id)


def fail_claimed_reminder(
    connection: Connection,
    *,
    reminder_id: str,
    claim_token: str,
    error_code: str,
) -> ReminderRecord | None:
    connection.execute(
        reminders.update()
        .where(
            reminders.c.id == reminder_id,
            reminders.c.status == "claimed",
            reminders.c.claim_token == claim_token,
        )
        .values(
            status="failed",
            claim_token=None,
            claimed_at=None,
            claim_expires_at=None,
            send_attempt_count=reminders.c.send_attempt_count + 1,
            last_error_code=error_code,
            updated_at=CURRENT_TIMESTAMP,
        )
    )
    return get_reminder_by_id(connection, reminder_id=reminder_id)


def delete_expired_captures(
    connection: Connection,
    *,
    now: datetime,
    limit: int,
) -> int:
    rows = connection.execute(
        sa.select(captures.c.id)
        .where(captures.c.expires_at <= now)
        .order_by(captures.c.expires_at.asc(), captures.c.id.asc())
        .limit(limit)
    ).fetchall()
    capture_ids = [str(row.id) for row in rows]
    if not capture_ids:
        return 0

    result = connection.execute(captures.delete().where(captures.c.id.in_(capture_ids)))
    return int(result.rowcount or 0)


def upsert_reminder(
    connection: Connection,
    *,
    user_id: str,
    task_id: str,
    scheduled_for: datetime,
) -> ReminderRecord:
    existing = get_reminder_by_task_id(connection, user_id=user_id, task_id=task_id)
    if existing is None:
        return create_reminder(
            connection,
            user_id=user_id,
            task_id=task_id,
            scheduled_for=scheduled_for,
        )

    idempotency_key = f"task:{task_id}:scheduled:{scheduled_for.isoformat()}"
    connection.execute(
        reminders.update()
        .where(reminders.c.id == existing.id, reminders.c.user_id == user_id)
        .values(
            scheduled_for=scheduled_for,
            status="pending",
            idempotency_key=idempotency_key,
            claim_token=None,
            claimed_at=None,
            claim_expires_at=None,
            send_attempt_count=0,
            last_error_code=None,
            provider_message_id=None,
            sent_at=None,
            cancelled_at=None,
            updated_at=CURRENT_TIMESTAMP,
        )
    )
    row = connection.execute(sa.select(reminders).where(reminders.c.id == existing.id)).one()
    return _row_to_reminder(row)


def create_extracted_task(
    connection: Connection,
    *,
    user_id: str,
    capture_id: str,
    title: str,
    description: str | None,
    group_id: str,
    group_name: str | None,
    due_date: date | None,
    reminder_at: datetime | None,
    recurrence_frequency: str | None,
    recurrence_weekday: int | None,
    recurrence_day_of_month: int | None,
    top_confidence: float,
    needs_review: bool,
    subtask_titles: list[str] | None = None,
) -> ExtractedTaskRecord:
    extracted_task_id = str(uuid.uuid4())
    connection.execute(
        extracted_tasks.insert().values(
            id=extracted_task_id,
            user_id=user_id,
            capture_id=capture_id,
            title=title,
            description=description,
            group_id=group_id,
            group_name=group_name,
            due_date=due_date,
            reminder_at=reminder_at,
            recurrence_frequency=recurrence_frequency,
            recurrence_weekday=recurrence_weekday,
            recurrence_day_of_month=recurrence_day_of_month,
            top_confidence=top_confidence,
            needs_review=needs_review,
            subtask_titles=subtask_titles or [],
            status="pending",
        )
    )
    row = connection.execute(
        sa.select(extracted_tasks).where(extracted_tasks.c.id == extracted_task_id)
    ).one()
    return _row_to_extracted_task(row)


def get_extracted_task(
    connection: Connection,
    *,
    user_id: str,
    extracted_task_id: str,
) -> ExtractedTaskRecord | None:
    row = connection.execute(
        sa.select(extracted_tasks).where(
            extracted_tasks.c.id == extracted_task_id,
            extracted_tasks.c.user_id == user_id,
        )
    ).first()
    if row is None:
        return None
    return _row_to_extracted_task(row)


def list_extracted_tasks(
    connection: Connection,
    *,
    user_id: str,
    capture_id: str | None = None,
    status: str | None = None,
) -> list[ExtractedTaskRecord]:
    conditions = [extracted_tasks.c.user_id == user_id]
    if capture_id is not None:
        conditions.append(extracted_tasks.c.capture_id == capture_id)
    if status is not None:
        conditions.append(extracted_tasks.c.status == status)

    rows = connection.execute(
        sa.select(extracted_tasks)
        .where(*conditions)
        .order_by(extracted_tasks.c.created_at.asc(), extracted_tasks.c.id.asc())
    ).fetchall()
    return [_row_to_extracted_task(row) for row in rows]


def update_extracted_task_status(
    connection: Connection,
    *,
    user_id: str,
    extracted_task_id: str,
    status: str,
) -> ExtractedTaskRecord | None:
    connection.execute(
        extracted_tasks.update()
        .where(
            extracted_tasks.c.id == extracted_task_id,
            extracted_tasks.c.user_id == user_id,
        )
        .values(status=status, updated_at=CURRENT_TIMESTAMP)
    )
    return get_extracted_task(connection, user_id=user_id, extracted_task_id=extracted_task_id)


def update_extracted_task_due_date(
    connection: Connection,
    *,
    user_id: str,
    extracted_task_id: str,
    due_date: date | None,
) -> ExtractedTaskRecord | None:
    """Update the due_date of an extracted task.

    Args:
        connection: Database connection.
        user_id: User ID for ownership verification.
        extracted_task_id: Extracted task ID.
        due_date: New due_date value (None to clear).

    Returns:
        Updated extracted task record or None if not found.
    """
    connection.execute(
        extracted_tasks.update()
        .where(
            extracted_tasks.c.id == extracted_task_id,
            extracted_tasks.c.user_id == user_id,
        )
        .values(due_date=due_date, updated_at=CURRENT_TIMESTAMP)
    )
    return get_extracted_task(connection, user_id=user_id, extracted_task_id=extracted_task_id)


def update_extracted_task(
    connection: Connection,
    *,
    user_id: str,
    extracted_task_id: str,
    values: dict[str, object],
) -> ExtractedTaskRecord | None:
    """Update an extracted task with a partial set of fields.

    The caller is responsible for validating that `values` only contains supported fields and
    that those values are valid for the extracted-task -> task approval pipeline.

    Args:
        connection: Database connection.
        user_id: User ID for ownership verification.
        extracted_task_id: Extracted task ID.
        values: A dict of fields to update. Keys not present are left unchanged. Values may be
            explicitly set to None to clear nullable fields.

    Returns:
        Updated extracted task record or None if not found.
    """
    if not values:
        return get_extracted_task(connection, user_id=user_id, extracted_task_id=extracted_task_id)

    update_values = dict(values)
    update_values["updated_at"] = CURRENT_TIMESTAMP

    connection.execute(
        extracted_tasks.update()
        .where(
            extracted_tasks.c.id == extracted_task_id,
            extracted_tasks.c.user_id == user_id,
        )
        .values(**update_values)
    )
    return get_extracted_task(connection, user_id=user_id, extracted_task_id=extracted_task_id)


def delete_extracted_tasks_by_capture(
    connection: Connection,
    *,
    user_id: str,
    capture_id: str,
    status: str | None = None,
) -> int:
    """Delete extracted tasks for a capture.

    Args:
        connection: Database connection.
        user_id: User ID.
        capture_id: Capture ID.
        status: Optional status filter. If provided, only tasks with this status are deleted.
                If None, only pending tasks are deleted (for re-extraction safety).

    Returns:
        Number of deleted rows.
    """
    conditions = [
        extracted_tasks.c.user_id == user_id,
        extracted_tasks.c.capture_id == capture_id,
    ]
    if status is not None:
        conditions.append(extracted_tasks.c.status == status)
    else:
        # Default: only delete pending tasks (safety measure for re-extraction)
        conditions.append(extracted_tasks.c.status == "pending")

    result = connection.execute(extracted_tasks.delete().where(*conditions))
    return int(result.rowcount or 0)


def delete_expired_extracted_tasks(
    connection: Connection,
    *,
    now: datetime,
    limit: int,
) -> int:
    """Delete expired extracted tasks that have been approved or discarded.

    Pending tasks are never automatically deleted - they persist until user action.

    Args:
        connection: Database connection.
        now: Current datetime.
        limit: Maximum number of rows to delete.

    Returns:
        Number of deleted rows.
    """
    cutoff = now - timedelta(days=7)
    rows = connection.execute(
        sa.select(extracted_tasks.c.id)
        .where(
            extracted_tasks.c.created_at <= cutoff,
            extracted_tasks.c.status.in_(["approved", "discarded"]),
        )
        .order_by(extracted_tasks.c.created_at.asc(), extracted_tasks.c.id.asc())
        .limit(limit)
    ).fetchall()
    extracted_task_ids = [str(row.id) for row in rows]
    if not extracted_task_ids:
        return 0

    result = connection.execute(
        extracted_tasks.delete().where(extracted_tasks.c.id.in_(extracted_task_ids))
    )
    return int(result.rowcount or 0)


def cancel_reminder(
    connection: Connection,
    *,
    user_id: str,
    task_id: str,
) -> ReminderRecord | None:
    existing = get_reminder_by_task_id(connection, user_id=user_id, task_id=task_id)
    if existing is None:
        return None

    connection.execute(
        reminders.update()
        .where(reminders.c.id == existing.id, reminders.c.user_id == user_id)
        .values(
            status="cancelled",
            claim_token=None,
            claimed_at=None,
            claim_expires_at=None,
            cancelled_at=CURRENT_TIMESTAMP,
            updated_at=CURRENT_TIMESTAMP,
        )
    )
    row = connection.execute(sa.select(reminders).where(reminders.c.id == existing.id)).one()
    return _row_to_reminder(row)
