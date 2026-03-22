from __future__ import annotations

# ruff: noqa: UP045
import uuid
from dataclasses import dataclass
from datetime import date, datetime
from typing import Optional

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from app.db.schema import captures, groups, reminders, subtasks, tasks, users


@dataclass
class UserRecord:
    id: str
    email: str
    display_name: Optional[str]
    timezone: str


@dataclass
class GroupRecord:
    id: str
    user_id: str
    name: str
    description: Optional[str]
    is_system: bool
    system_key: Optional[str]


@dataclass
class GroupContextRecord(GroupRecord):
    recent_task_titles: list[str]


@dataclass
class CaptureRecord:
    id: str
    user_id: str
    input_type: str
    status: str
    source_text: Optional[str]
    transcript_text: Optional[str]
    transcript_edited_text: Optional[str]
    transcription_provider: Optional[str]
    transcription_latency_ms: Optional[int]
    extraction_attempt_count: int
    tasks_created_count: int
    tasks_skipped_count: int
    error_code: Optional[str]
    expires_at: datetime


@dataclass
class TaskRecord:
    id: str
    user_id: str
    group_id: str
    capture_id: Optional[str]
    title: str
    needs_review: bool
    due_date: Optional[date]
    reminder_at: Optional[datetime]
    reminder_offset_minutes: Optional[int]


@dataclass
class ReminderRecord:
    id: str
    user_id: str
    task_id: str
    scheduled_for: datetime
    status: str
    idempotency_key: str


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
        title=row.title,
        needs_review=bool(row.needs_review),
        due_date=row.due_date,
        reminder_at=row.reminder_at,
        reminder_offset_minutes=row.reminder_offset_minutes,
    )


def _row_to_reminder(row: sa.Row) -> ReminderRecord:
    return ReminderRecord(
        id=str(row.id),
        user_id=str(row.user_id),
        task_id=str(row.task_id),
        scheduled_for=row.scheduled_for,
        status=row.status,
        idempotency_key=row.idempotency_key,
    )


def upsert_user(
    connection: Connection,
    *,
    user_id: str,
    email: str,
    display_name: Optional[str],
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
                "updated_at": sa.text("CURRENT_TIMESTAMP"),
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
                "updated_at": sa.text("CURRENT_TIMESTAMP"),
            },
        )

    connection.execute(statement)
    row = connection.execute(sa.select(users).where(users.c.id == user_id)).one()
    return _row_to_user(row)


def get_user(connection: Connection, user_id: str) -> Optional[UserRecord]:
    row = connection.execute(sa.select(users).where(users.c.id == user_id)).first()
    if row is None:
        return None
    return _row_to_user(row)


def update_user_timezone(
    connection: Connection,
    *,
    user_id: str,
    timezone: str,
) -> Optional[UserRecord]:
    connection.execute(
        users.update()
        .where(users.c.id == user_id)
        .values(timezone=timezone, updated_at=sa.text("CURRENT_TIMESTAMP"))
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


def get_session_context(connection: Connection, user_id: str) -> Optional[SessionContext]:
    user = get_user(connection, user_id)
    if user is None:
        return None

    inbox_group = ensure_inbox_group(connection, user_id=user_id)
    return SessionContext(user=user, inbox_group_id=inbox_group.id)


def create_capture(
    connection: Connection,
    *,
    user_id: str,
    input_type: str,
    status: str,
    expires_at: datetime,
    source_text: Optional[str] = None,
    transcript_text: Optional[str] = None,
    transcript_edited_text: Optional[str] = None,
    transcription_provider: Optional[str] = None,
    transcription_latency_ms: Optional[int] = None,
    error_code: Optional[str] = None,
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
) -> Optional[CaptureRecord]:
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
    status: Optional[str] = None,
    source_text: Optional[str] = None,
    transcript_text: Optional[str] = None,
    transcript_edited_text: Optional[str] = None,
    transcription_provider: Optional[str] = None,
    transcription_latency_ms: Optional[int] = None,
    extraction_attempt_count: Optional[int] = None,
    tasks_created_count: Optional[int] = None,
    tasks_skipped_count: Optional[int] = None,
    error_code: Optional[str] = None,
) -> Optional[CaptureRecord]:
    values = {"updated_at": sa.text("CURRENT_TIMESTAMP")}
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
    values["error_code"] = error_code

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


def create_task(
    connection: Connection,
    *,
    user_id: str,
    group_id: str,
    capture_id: Optional[str],
    title: str,
    needs_review: bool,
    due_date: Optional[date] = None,
    reminder_at: Optional[datetime] = None,
    reminder_offset_minutes: Optional[int] = None,
    recurrence_frequency: Optional[str] = None,
    recurrence_interval: Optional[int] = None,
    recurrence_weekday: Optional[int] = None,
    recurrence_day_of_month: Optional[int] = None,
) -> TaskRecord:
    task_id = str(uuid.uuid4())
    connection.execute(
        tasks.insert().values(
            id=task_id,
            user_id=user_id,
            group_id=group_id,
            capture_id=capture_id,
            series_id=None,
            title=title,
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


def create_subtasks(
    connection: Connection,
    *,
    user_id: str,
    task_id: str,
    titles: list[str],
) -> None:
    for title in titles:
        connection.execute(
            subtasks.insert().values(
                id=str(uuid.uuid4()),
                task_id=task_id,
                user_id=user_id,
                title=title,
            )
        )


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
