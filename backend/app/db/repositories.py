from __future__ import annotations

# ruff: noqa: UP045
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Optional

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from app.db.schema import captures, groups, reminders, subtasks, tasks, users

CURRENT_TIMESTAMP = sa.text("CURRENT_TIMESTAMP")


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
    series_id: Optional[str]
    title: str
    status: str
    needs_review: bool
    due_date: Optional[date]
    reminder_at: Optional[datetime]
    reminder_offset_minutes: Optional[int]
    recurrence_frequency: Optional[str]
    recurrence_interval: Optional[int]
    recurrence_weekday: Optional[int]
    recurrence_day_of_month: Optional[int]
    completed_at: Optional[datetime]
    deleted_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime


@dataclass
class SubtaskRecord:
    id: str
    task_id: str
    user_id: str
    title: str
    is_completed: bool
    completed_at: Optional[datetime]
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
    claim_token: Optional[str]
    claimed_at: Optional[datetime]
    claim_expires_at: Optional[datetime]
    send_attempt_count: int
    last_error_code: Optional[str]
    provider_message_id: Optional[str]
    sent_at: Optional[datetime]
    cancelled_at: Optional[datetime]


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


def get_session_context(connection: Connection, user_id: str) -> Optional[SessionContext]:
    user = get_user(connection, user_id)
    if user is None:
        return None

    inbox_group = ensure_inbox_group(connection, user_id=user_id)
    return SessionContext(user=user, inbox_group_id=inbox_group.id)


def get_group(connection: Connection, *, user_id: str, group_id: str) -> Optional[GroupRecord]:
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
    description: Optional[str],
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
) -> Optional[GroupRecord]:
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


def get_task(connection: Connection, *, user_id: str, task_id: str) -> Optional[TaskRecord]:
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
    group_id: Optional[str] = None,
    status: str = "open",
    include_deleted: bool = False,
) -> list[TaskRecord]:
    conditions = [tasks.c.user_id == user_id, tasks.c.status == status]
    if group_id is not None:
        conditions.append(tasks.c.group_id == group_id)
    if not include_deleted:
        conditions.append(tasks.c.deleted_at.is_(None))

    rows = connection.execute(
        sa.select(tasks)
        .where(*conditions)
        .order_by(tasks.c.created_at.desc(), tasks.c.id.desc())
    ).fetchall()
    return [_row_to_task(row) for row in rows]


def get_open_task_in_series(
    connection: Connection,
    *,
    user_id: str,
    series_id: str,
    exclude_task_id: Optional[str] = None,
) -> Optional[TaskRecord]:
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
    series_id: Optional[str] = None,
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
) -> Optional[TaskRecord]:
    update_values = {**values, "updated_at": CURRENT_TIMESTAMP}
    connection.execute(
        tasks.update()
        .where(tasks.c.id == task_id, tasks.c.user_id == user_id)
        .values(**update_values)
    )
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
) -> Optional[SubtaskRecord]:
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
) -> Optional[SubtaskRecord]:
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
) -> Optional[ReminderRecord]:
    row = connection.execute(
        sa.select(reminders).where(reminders.c.user_id == user_id, reminders.c.task_id == task_id)
    ).first()
    if row is None:
        return None
    return _row_to_reminder(row)


def get_reminder_by_id(connection: Connection, *, reminder_id: str) -> Optional[ReminderRecord]:
    row = connection.execute(sa.select(reminders).where(reminders.c.id == reminder_id)).first()
    if row is None:
        return None
    return _row_to_reminder(row)


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
) -> Optional[ReminderRecord]:
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
) -> Optional[ReminderRecord]:
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
) -> Optional[ReminderRecord]:
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
) -> Optional[ReminderRecord]:
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


def cancel_reminder(
    connection: Connection,
    *,
    user_id: str,
    task_id: str,
) -> Optional[ReminderRecord]:
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
