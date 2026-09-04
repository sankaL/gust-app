from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

import sqlalchemy as sa

from app.core.errors import (
    ConflictError,
    GroupNotFoundError,
    InvalidSubtaskError,
    InvalidTaskError,
    SubtaskNotFoundError,
    TaskNotFoundError,
)
from app.core.input_safety import MAX_TITLE_CHARS, validate_plain_text
from app.core.settings import Settings
from app.core.timing import timed_stage
from app.db.engine import user_connection_scope
from app.db.repositories import (
    GroupRecord,
    SubtaskRecord,
    TaskRecord,
    bulk_reassign_tasks,
    cancel_reminder,
    complete_task_if_open,
    create_subtask,
    create_subtasks,
    create_task,
    get_group,
    get_notification_preferences,
    get_open_task_in_series,
    get_subtask,
    get_task,
    list_open_tasks_in_series,
    list_subtasks,
    list_tasks,
    update_subtask,
    update_task,
    upsert_reminder,
)
from app.services.task_rules import (
    RecurrenceInput,
    compute_reminder_at_from_offset,
    due_bucket_for_date,
    next_due_date_for_completed_task,
    next_due_date_for_deleted_occurrence,
    normalize_task_description,
    normalize_task_fields,
)


@dataclass
class TaskListItem:
    task: TaskRecord
    group: GroupRecord
    due_bucket: str
    subtask_count: int = 0


@dataclass
class PaginatedTaskList:
    items: list[TaskListItem]
    has_more: bool
    next_cursor: str | None


@dataclass
class TaskDetail:
    task: TaskRecord
    group: GroupRecord
    subtasks: list[SubtaskRecord]


@dataclass
class TaskUpdateInput:
    title: str
    description: str | None
    description_provided: bool
    group_id: str
    due_date: date | None
    reminder_at: datetime | None
    reminder_date: date | None
    reminder_date_provided: bool
    recurrence: RecurrenceInput | None
    reminder_at_provided: bool = True


@dataclass
class TaskCreateInput:
    title: str
    description: str | None
    group_id: str
    due_date: date | None
    reminder_at: datetime | None
    reminder_date: date | None
    recurrence: RecurrenceInput | None


class TaskService:
    def __init__(self, *, settings: Settings) -> None:
        self.settings = settings

    def list_tasks(
        self,
        *,
        user_id: str,
        user_timezone: str,
        group_id: str | None = None,
        status: str = "open",
        limit: int = 50,
        cursor: str | None = None,
        search_query: str | None = None,
        completed_start: date | None = None,
        completed_end: date | None = None,
    ) -> PaginatedTaskList:
        with (
            timed_stage("db.tasks.list"),
            user_connection_scope(self.settings.database_url, user_id=user_id) as connection,
        ):
            # Validate group exists if group_id is provided (skip validation for 'all')
            if group_id is not None and group_id != "all":
                group = get_group(connection, user_id=user_id, group_id=group_id)
                if group is None:
                    raise GroupNotFoundError()

            completed_start_at: datetime | None = None
            completed_end_at: datetime | None = None
            if status == "completed":
                zone = ZoneInfo(user_timezone)
                if completed_start is not None:
                    completed_start_at = datetime.combine(
                        completed_start, datetime.min.time(), tzinfo=zone
                    ).astimezone(UTC)
                if completed_end is not None:
                    completed_end_at = datetime.combine(
                        completed_end, datetime.min.time(), tzinfo=zone
                    ).astimezone(UTC)

            task_rows, has_more, next_cursor = list_tasks(
                connection,
                user_id=user_id,
                group_id=group_id,
                status=status,
                limit=limit,
                cursor=cursor,
                search_query=search_query.strip() if search_query else None,
                completed_start=completed_start_at,
                completed_end=completed_end_at,
            )

        items = [
            TaskListItem(
                task=row.task,
                group=row.group,
                due_bucket=self._due_bucket(task=row.task, user_timezone=user_timezone),
                subtask_count=row.task.subtask_count,
            )
            for row in task_rows
        ]
        if status == "completed":
            items.sort(key=self._completed_task_sort_key)
        else:
            items.sort(key=lambda item: self._task_sort_key(item=item, user_timezone=user_timezone))
        return PaginatedTaskList(items=items, has_more=has_more, next_cursor=next_cursor)

    def get_task_detail(self, *, user_id: str, task_id: str) -> TaskDetail:
        with (
            timed_stage("db.tasks.detail"),
            user_connection_scope(self.settings.database_url, user_id=user_id) as connection,
        ):
            task = get_task(connection, user_id=user_id, task_id=task_id)
            if task is None:
                raise TaskNotFoundError()
            group = get_group(connection, user_id=user_id, group_id=task.group_id)
            if group is None:
                raise GroupNotFoundError("Task group could not be found.")
            task_subtasks = list_subtasks(connection, user_id=user_id, task_id=task_id)
        return TaskDetail(task=task, group=group, subtasks=task_subtasks)

    def create_task(
        self,
        *,
        user_id: str,
        user_timezone: str,
        payload: TaskCreateInput,
    ) -> TaskDetail:
        with user_connection_scope(self.settings.database_url, user_id=user_id) as connection:
            destination_group = get_group(connection, user_id=user_id, group_id=payload.group_id)
            if destination_group is None:
                raise GroupNotFoundError("Destination group could not be found.")

            normalized = self._normalize_fields(
                title=payload.title,
                due_date=payload.due_date,
                reminder_at=payload.reminder_at,
                reminder_date=payload.reminder_date,
                recurrence=payload.recurrence,
                user_timezone=user_timezone,
                current_series_id=None,
            )

            created = create_task(
                connection,
                user_id=user_id,
                group_id=payload.group_id,
                capture_id=None,
                title=normalized.title,
                needs_review=False,
                description=normalize_task_description(payload.description, title=normalized.title),
                due_date=normalized.due_date,
                reminder_at=normalized.reminder_at,
                reminder_date=normalized.reminder_date,
                reminder_offset_minutes=normalized.reminder_offset_minutes,
                recurrence_frequency=normalized.recurrence_frequency,
                recurrence_interval=normalized.recurrence_interval,
                recurrence_weekday=normalized.recurrence_weekday,
                recurrence_day_of_month=normalized.recurrence_day_of_month,
                recurrence_month=normalized.recurrence_month,
                series_id=normalized.series_id,
            )
            self._sync_reminder(
                connection,
                user_id=user_id,
                task=created,
                user_timezone=user_timezone,
                now=datetime.now(UTC),
            )
            group = get_group(connection, user_id=user_id, group_id=created.group_id)
            assert group is not None
            task_subtasks = list_subtasks(connection, user_id=user_id, task_id=created.id)

        return TaskDetail(task=created, group=group, subtasks=task_subtasks)

    def update_task(
        self,
        *,
        user_id: str,
        user_timezone: str,
        task_id: str,
        payload: TaskUpdateInput,
    ) -> TaskDetail:
        with user_connection_scope(self.settings.database_url, user_id=user_id) as connection:
            existing = get_task(connection, user_id=user_id, task_id=task_id)
            if existing is None:
                raise TaskNotFoundError()
            destination_group = get_group(connection, user_id=user_id, group_id=payload.group_id)
            if destination_group is None:
                raise GroupNotFoundError("Destination group could not be found.")

            reminder_date = payload.reminder_date
            if not payload.reminder_date_provided and payload.reminder_at is None:
                reminder_date = existing.reminder_date

            reminder_at = payload.reminder_at

            now = datetime.now(UTC)
            user_tz = ZoneInfo(user_timezone)
            today = now.astimezone(user_tz).date()

            is_overdue_or_today = existing.due_date is not None and existing.due_date <= today
            is_moving_to_future = payload.due_date is not None and payload.due_date > today

            explicitly_cleared_reminders = (
                payload.reminder_at is None
                and payload.reminder_date is None
                and payload.reminder_date_provided
                and payload.reminder_at_provided
            )

            if (
                is_moving_to_future
                and is_overdue_or_today
                and not explicitly_cleared_reminders
            ):
                has_explicit_date_reminder = (
                    payload.reminder_date_provided and reminder_date is not None
                )
                if existing.reminder_at is not None and not has_explicit_date_reminder:
                    needs_shift = (
                        reminder_at is None
                        or reminder_at <= now
                        or reminder_at == existing.reminder_at
                        or reminder_at.astimezone(user_tz).date() <= today
                    )
                    if needs_shift:
                        existing_tz = existing.reminder_at.tzinfo or UTC
                        existing_local = existing.reminder_at.replace(
                            tzinfo=existing_tz
                        ).astimezone(user_tz)
                        new_local = datetime.combine(
                            payload.due_date,
                            existing_local.time(),
                            tzinfo=user_tz,
                        )
                        reminder_at = new_local.astimezone(UTC)
                        reminder_date = None
                elif existing.reminder_date is not None:
                    needs_shift = (
                        reminder_date is None
                        or reminder_date <= today
                        or reminder_date == existing.reminder_date
                    )
                    if needs_shift and reminder_at is None:
                        reminder_date = payload.due_date
                        reminder_at = None

            normalized = self._normalize_fields(
                title=payload.title,
                due_date=payload.due_date,
                reminder_at=reminder_at,
                reminder_date=reminder_date,
                recurrence=payload.recurrence,
                user_timezone=user_timezone,
                current_series_id=existing.series_id,
            )

            values: dict[str, object] = {
                "title": normalized.title,
                "group_id": payload.group_id,
                "needs_review": (
                    False if payload.group_id != existing.group_id else existing.needs_review
                ),
                "due_date": normalized.due_date,
                "reminder_at": normalized.reminder_at,
                "reminder_date": normalized.reminder_date,
                "reminder_offset_minutes": normalized.reminder_offset_minutes,
                "recurrence_frequency": normalized.recurrence_frequency,
                "recurrence_interval": normalized.recurrence_interval,
                "recurrence_weekday": normalized.recurrence_weekday,
                "recurrence_day_of_month": normalized.recurrence_day_of_month,
                "recurrence_month": normalized.recurrence_month,
                "series_id": normalized.series_id,
            }
            if payload.description_provided:
                values["description"] = normalize_task_description(
                    payload.description,
                    title=normalized.title,
                )
            updated = update_task(connection, user_id=user_id, task_id=task_id, values=values)
            assert updated is not None
            self._sync_reminder(
                connection,
                user_id=user_id,
                task=updated,
                user_timezone=user_timezone,
                now=datetime.now(UTC),
                preserve_sent=(
                    existing.reminder_at == updated.reminder_at
                    and existing.reminder_date == updated.reminder_date
                ),
            )
            group = get_group(connection, user_id=user_id, group_id=updated.group_id)
            assert group is not None
            task_subtasks = list_subtasks(connection, user_id=user_id, task_id=task_id)

        return TaskDetail(task=updated, group=group, subtasks=task_subtasks)

    def complete_task(self, *, user_id: str, user_timezone: str, task_id: str) -> TaskDetail:
        with user_connection_scope(self.settings.database_url, user_id=user_id) as connection:
            task = get_task(connection, user_id=user_id, task_id=task_id)
            if task is None or task.deleted_at is not None:
                raise TaskNotFoundError()
            if task.status != "open":
                raise ConflictError(
                    "task_completion_conflict",
                    "Only open tasks can be completed.",
                )
            if task.recurrence_frequency is not None and task.due_date is not None:
                local_today = datetime.now(ZoneInfo(user_timezone)).date()
                if task.due_date > local_today:
                    raise ConflictError(
                        "task_completion_conflict",
                        "Recurring tasks can only be completed on or after their due date.",
                    )
            series_id_to_assign: str | None = None
            if task.recurrence_frequency is not None and task.series_id is None:
                series_id_to_assign = str(uuid.uuid4())
            completed_at = datetime.now(UTC)
            updated = complete_task_if_open(
                connection,
                user_id=user_id,
                task_id=task_id,
                completed_at=completed_at,
                series_id=series_id_to_assign,
            )
            if updated is None:
                raise ConflictError(
                    "task_completion_conflict",
                    "Only open tasks can be completed.",
                )
            cancel_reminder(connection, user_id=user_id, task_id=task_id)
            self._create_next_occurrence_on_completion(
                connection,
                user_id=user_id,
                user_timezone=user_timezone,
                task=updated,
                completed_at=completed_at,
            )
            group = get_group(connection, user_id=user_id, group_id=updated.group_id)
            assert group is not None
            task_subtasks = list_subtasks(connection, user_id=user_id, task_id=task_id)
        return TaskDetail(task=updated, group=group, subtasks=task_subtasks)

    def reopen_task(self, *, user_id: str, user_timezone: str, task_id: str) -> TaskDetail:
        with user_connection_scope(self.settings.database_url, user_id=user_id) as connection:
            task = get_task(connection, user_id=user_id, task_id=task_id)
            if task is None or task.deleted_at is not None:
                raise TaskNotFoundError()
            if task.status != "completed":
                raise ConflictError(
                    "task_reopen_conflict",
                    "Only completed tasks can be moved back to To-do.",
                )
            reopen_disposition = self._reconcile_series_on_reopen(
                connection,
                user_id=user_id,
                user_timezone=user_timezone,
                task=task,
            )
            recurrence_reset_values: dict[str, object] = (
                self._recurrence_reset_values(task=task)
                if reopen_disposition == "detach_instance"
                else {}
            )
            updated = update_task(
                connection,
                user_id=user_id,
                task_id=task_id,
                values={
                    "status": "open",
                    "completed_at": None,
                    **recurrence_reset_values,
                },
            )
            assert updated is not None
            self._sync_reminder(
                connection,
                user_id=user_id,
                task=updated,
                user_timezone=user_timezone,
                now=datetime.now(UTC),
            )
            group = get_group(connection, user_id=user_id, group_id=updated.group_id)
            assert group is not None
            task_subtasks = list_subtasks(connection, user_id=user_id, task_id=task_id)
        return TaskDetail(task=updated, group=group, subtasks=task_subtasks)

    def delete_task(
        self,
        *,
        user_id: str,
        user_timezone: str,
        task_id: str,
        scope: str = "occurrence",
    ) -> TaskDetail:
        with user_connection_scope(self.settings.database_url, user_id=user_id) as connection:
            task = get_task(connection, user_id=user_id, task_id=task_id)
            if task is None:
                raise TaskNotFoundError()
            if task.deleted_at is not None:
                raise ConflictError(
                    "task_delete_conflict",
                    "Only active tasks can be deleted.",
                )
            deleted_at = datetime.now(UTC)

            if scope == "series":
                task = self._ensure_series_id_for_recurring_task(
                    connection,
                    user_id=user_id,
                    task=task,
                )
                if task.series_id is None or task.recurrence_frequency is None:
                    raise InvalidTaskError("Series delete is only supported for recurring tasks.")
                if task.status != "open":
                    raise InvalidTaskError(
                        "Series delete is only supported for open recurring tasks."
                    )
                open_tasks = list_open_tasks_in_series(
                    connection,
                    user_id=user_id,
                    series_id=task.series_id,
                )
                for series_task in open_tasks:
                    update_task(
                        connection,
                        user_id=user_id,
                        task_id=series_task.id,
                        values={"deleted_at": deleted_at},
                    )
                    cancel_reminder(connection, user_id=user_id, task_id=series_task.id)
                updated = get_task(connection, user_id=user_id, task_id=task_id)
                assert updated is not None
            else:
                series_id_to_assign: str | None = None
                if task.recurrence_frequency is not None and task.series_id is None:
                    series_id_to_assign = str(uuid.uuid4())
                updated = update_task(
                    connection,
                    user_id=user_id,
                    task_id=task_id,
                    values={
                        "deleted_at": deleted_at,
                        "series_id": series_id_to_assign or task.series_id,
                    },
                )
                assert updated is not None
                cancel_reminder(connection, user_id=user_id, task_id=task_id)
                self._create_next_occurrence_on_delete(
                    connection,
                    user_id=user_id,
                    user_timezone=user_timezone,
                    task=updated,
                    deleted_at=deleted_at,
                )

            group = get_group(connection, user_id=user_id, group_id=updated.group_id)
            assert group is not None
            task_subtasks = list_subtasks(connection, user_id=user_id, task_id=task_id)
        return TaskDetail(task=updated, group=group, subtasks=task_subtasks)

    def restore_task(
        self,
        *,
        user_id: str,
        user_timezone: str,
        task_id: str,
    ) -> TaskDetail:
        with user_connection_scope(self.settings.database_url, user_id=user_id) as connection:
            task = get_task(connection, user_id=user_id, task_id=task_id)
            if task is None:
                raise TaskNotFoundError()
            if task.deleted_at is None:
                raise ConflictError(
                    "task_restore_conflict",
                    "Only deleted tasks can be restored.",
                )
            restore_disposition = self._reconcile_series_on_restore(
                connection,
                user_id=user_id,
                user_timezone=user_timezone,
                task=task,
            )
            recurrence_reset_values: dict[str, object] = (
                self._recurrence_reset_values(task=task)
                if restore_disposition == "detach_instance"
                else {}
            )
            updated = update_task(
                connection,
                user_id=user_id,
                task_id=task_id,
                values={
                    "deleted_at": None,
                    **recurrence_reset_values,
                },
            )
            assert updated is not None
            self._sync_reminder(
                connection,
                user_id=user_id,
                task=updated,
                user_timezone=user_timezone,
                now=datetime.now(UTC),
            )
            group = get_group(connection, user_id=user_id, group_id=updated.group_id)
            assert group is not None
            task_subtasks = list_subtasks(connection, user_id=user_id, task_id=task_id)
        return TaskDetail(task=updated, group=group, subtasks=task_subtasks)

    def create_subtask(self, *, user_id: str, task_id: str, title: str) -> SubtaskRecord:
        try:
            normalized_title = validate_plain_text(
                title,
                field_name="Subtask title",
                max_length=MAX_TITLE_CHARS,
            )
        except ValueError as exc:
            raise InvalidSubtaskError(str(exc)) from exc

        with user_connection_scope(self.settings.database_url, user_id=user_id) as connection:
            task = get_task(connection, user_id=user_id, task_id=task_id)
            if task is None:
                raise TaskNotFoundError()
            return create_subtask(
                connection,
                user_id=user_id,
                task_id=task_id,
                title=normalized_title,
            )

    def update_subtask(
        self,
        *,
        user_id: str,
        task_id: str,
        subtask_id: str,
        title: str | None,
        is_completed: bool | None,
    ) -> SubtaskRecord:
        if title is None and is_completed is None:
            raise InvalidSubtaskError("At least one subtask field must be provided.")

        with user_connection_scope(self.settings.database_url, user_id=user_id) as connection:
            task = get_task(connection, user_id=user_id, task_id=task_id)
            if task is None:
                raise TaskNotFoundError()
            existing = get_subtask(
                connection,
                user_id=user_id,
                task_id=task_id,
                subtask_id=subtask_id,
            )
            if existing is None:
                raise SubtaskNotFoundError()

            values: dict[str, object] = {}
            if title is not None:
                try:
                    values["title"] = validate_plain_text(
                        title,
                        field_name="Subtask title",
                        max_length=MAX_TITLE_CHARS,
                    )
                except ValueError as exc:
                    raise InvalidSubtaskError(str(exc)) from exc
            if is_completed is not None:
                values["is_completed"] = is_completed
                values["completed_at"] = datetime.now(UTC) if is_completed else None

            updated = update_subtask(
                connection,
                user_id=user_id,
                task_id=task_id,
                subtask_id=subtask_id,
                values=values,
            )
            if updated is None:
                raise SubtaskNotFoundError()
            return updated

    def delete_subtask(self, *, user_id: str, task_id: str, subtask_id: str) -> None:
        with user_connection_scope(self.settings.database_url, user_id=user_id) as connection:
            task = get_task(connection, user_id=user_id, task_id=task_id)
            if task is None:
                raise TaskNotFoundError()
            existing = get_subtask(
                connection,
                user_id=user_id,
                task_id=task_id,
                subtask_id=subtask_id,
            )
            if existing is None:
                raise SubtaskNotFoundError()
            from app.db.repositories import delete_subtask as delete_subtask_row

            delete_subtask_row(connection, user_id=user_id, task_id=task_id, subtask_id=subtask_id)

    def reassign_tasks_for_deleted_group(
        self,
        *,
        connection: sa.Connection,
        user_id: str,
        source_group_id: str,
        destination_group_id: str,
    ) -> None:
        bulk_reassign_tasks(
            connection,
            user_id=user_id,
            source_group_id=source_group_id,
            destination_group_id=destination_group_id,
        )

    def _list_groups(self, connection: sa.Connection, *, user_id: str) -> list[GroupRecord]:
        from app.db.repositories import list_groups_with_counts

        return list_groups_with_counts(connection, user_id=user_id)

    def _normalize_fields(
        self,
        *,
        title: str,
        due_date: date | None,
        reminder_at: datetime | None,
        reminder_date: date | None,
        recurrence: RecurrenceInput | None,
        user_timezone: str,
        current_series_id: str | None,
    ):
        try:
            now = datetime.now(UTC)
            if (
                reminder_date is not None
                and reminder_date < now.astimezone(ZoneInfo(user_timezone)).date()
            ):
                raise ValueError("Date-only reminder cannot be in the past.")
            if reminder_at is not None and reminder_at <= now:
                raise ValueError("Date-and-time reminder must be in the future.")
            return normalize_task_fields(
                title=title,
                due_date=due_date,
                reminder_at=reminder_at,
                reminder_date=reminder_date,
                recurrence=recurrence,
                user_timezone=user_timezone,
                current_series_id=current_series_id,
            )
        except ValueError as exc:
            raise InvalidTaskError(str(exc)) from exc

    def _sync_reminder(
        self,
        connection: sa.Connection,
        *,
        user_id: str,
        task: TaskRecord,
        now: datetime,
        user_timezone: str,
        preserve_sent: bool = False,
    ) -> None:
        self._sync_task_reminder(
            connection,
            settings=self.settings,
            user_id=user_id,
            task=task,
            user_timezone=user_timezone,
            now=now,
            preserve_sent=preserve_sent,
        )


    @staticmethod
    def _sync_task_reminder(
        connection: sa.Connection,
        *,
        settings: Settings,
        user_id: str,
        task: TaskRecord,
        user_timezone: str,
        now: datetime,
        preserve_sent: bool = False,
    ) -> None:
        preferences = get_notification_preferences(connection, user_id=user_id)
        if (
            not settings.pushover_notifications_enabled
            or not preferences.pushover_enabled
            or not preferences.pushover_task_reminders_enabled
            or not preferences.pushover_user_key_encrypted
            or (task.reminder_at is None and task.reminder_date is None)
        ):
            cancel_reminder(connection, user_id=user_id, task_id=task.id)
            return
        if task.reminder_at is not None:
            reminder_at = task.reminder_at
            if reminder_at.tzinfo is None:
                reminder_at = reminder_at.replace(tzinfo=UTC)
            if reminder_at <= now:
                cancel_reminder(connection, user_id=user_id, task_id=task.id)
                return
            scheduled_for = reminder_at - timedelta(minutes=30)
            if scheduled_for < now:
                scheduled_for = now
        else:
            assert task.reminder_date is not None
            local_target = datetime.combine(
                task.reminder_date,
                preferences.date_only_reminder_time,
                tzinfo=ZoneInfo(user_timezone),
            )
            scheduled_for = local_target.astimezone(UTC)
            if scheduled_for < now:
                scheduled_for = now
        upsert_reminder(
            connection,
            user_id=user_id,
            task_id=task.id,
            scheduled_for=scheduled_for,
            preserve_sent=preserve_sent,
        )

    def _create_next_occurrence_on_completion(
        self,
        connection: sa.Connection,
        *,
        user_id: str,
        user_timezone: str,
        task: TaskRecord,
        completed_at: datetime,
    ) -> None:
        if task.series_id is None or task.recurrence_frequency is None:
            return

        existing_open = get_open_task_in_series(
            connection,
            user_id=user_id,
            series_id=task.series_id,
            exclude_task_id=task.id,
        )
        if existing_open is not None:
            return

        next_due_date, next_day_of_month = next_due_date_for_completed_task(
            completed_at=completed_at,
            recurrence_frequency=task.recurrence_frequency,
            recurrence_weekday=task.recurrence_weekday,
            recurrence_day_of_month=task.recurrence_day_of_month,
            recurrence_month=task.recurrence_month,
            user_timezone=user_timezone,
        )

        next_reminder_at = None
        if task.reminder_offset_minutes is not None:
            derived_reminder_at = compute_reminder_at_from_offset(
                due_date=next_due_date,
                reminder_offset_minutes=task.reminder_offset_minutes,
                user_timezone=user_timezone,
            ).astimezone(UTC)
            if derived_reminder_at > completed_at:
                next_reminder_at = derived_reminder_at

        next_task = create_task(
            connection,
            user_id=user_id,
            group_id=task.group_id,
            capture_id=None,
            title=task.title,
            needs_review=False,
            description=task.description,
            due_date=next_due_date,
            reminder_at=next_reminder_at,
            reminder_date=(
                next_due_date + (task.reminder_date - task.due_date)
                if task.reminder_date is not None and task.due_date is not None
                else None
            ),
            reminder_offset_minutes=task.reminder_offset_minutes,
            recurrence_frequency=task.recurrence_frequency,
            recurrence_interval=task.recurrence_interval,
            recurrence_weekday=task.recurrence_weekday,
            recurrence_day_of_month=(
                next_day_of_month
                if task.recurrence_frequency in ("monthly", "yearly")
                else task.recurrence_day_of_month
            ),
            recurrence_month=(
                task.recurrence_month if task.recurrence_frequency == "yearly" else None
            ),
            series_id=task.series_id,
        )

        source_subtasks = list_subtasks(connection, user_id=user_id, task_id=task.id)
        if source_subtasks:
            create_subtasks(
                connection,
                user_id=user_id,
                task_id=next_task.id,
                titles=[subtask.title for subtask in source_subtasks],
            )

        self._sync_reminder(
            connection,
            user_id=user_id,
            task=next_task,
            now=completed_at,
            user_timezone=user_timezone,
        )

    def _create_next_occurrence_on_delete(
        self,
        connection: sa.Connection,
        *,
        user_id: str,
        user_timezone: str,
        task: TaskRecord,
        deleted_at: datetime,
    ) -> None:
        if task.status != "open" or task.series_id is None or task.recurrence_frequency is None:
            return

        occurrence_due_date = task.due_date
        if occurrence_due_date is None:
            occurrence_due_date = deleted_at.astimezone(ZoneInfo(user_timezone)).date()

        existing_open = get_open_task_in_series(
            connection,
            user_id=user_id,
            series_id=task.series_id,
            exclude_task_id=task.id,
        )
        if existing_open is not None:
            return

        next_due_date, next_day_of_month = next_due_date_for_deleted_occurrence(
            occurrence_due_date=occurrence_due_date,
            recurrence_frequency=task.recurrence_frequency,
            recurrence_weekday=task.recurrence_weekday,
            recurrence_day_of_month=task.recurrence_day_of_month,
            recurrence_month=task.recurrence_month,
        )

        next_reminder_at = None
        if task.reminder_offset_minutes is not None:
            derived_reminder_at = compute_reminder_at_from_offset(
                due_date=next_due_date,
                reminder_offset_minutes=task.reminder_offset_minutes,
                user_timezone=user_timezone,
            ).astimezone(UTC)
            if derived_reminder_at > deleted_at:
                next_reminder_at = derived_reminder_at

        next_task = create_task(
            connection,
            user_id=user_id,
            group_id=task.group_id,
            capture_id=None,
            title=task.title,
            needs_review=False,
            description=task.description,
            due_date=next_due_date,
            reminder_at=next_reminder_at,
            reminder_date=(
                next_due_date + (task.reminder_date - task.due_date)
                if task.reminder_date is not None and task.due_date is not None
                else None
            ),
            reminder_offset_minutes=task.reminder_offset_minutes,
            recurrence_frequency=task.recurrence_frequency,
            recurrence_interval=task.recurrence_interval,
            recurrence_weekday=task.recurrence_weekday,
            recurrence_day_of_month=(
                next_day_of_month
                if task.recurrence_frequency in ("monthly", "yearly")
                else task.recurrence_day_of_month
            ),
            recurrence_month=(
                task.recurrence_month if task.recurrence_frequency == "yearly" else None
            ),
            series_id=task.series_id,
        )

        source_subtasks = list_subtasks(connection, user_id=user_id, task_id=task.id)
        if source_subtasks:
            create_subtasks(
                connection,
                user_id=user_id,
                task_id=next_task.id,
                titles=[subtask.title for subtask in source_subtasks],
            )

        self._sync_reminder(
            connection, user_id=user_id, task=next_task, now=deleted_at, user_timezone=user_timezone
        )

    def _reconcile_series_on_reopen(
        self,
        connection: sa.Connection,
        *,
        user_id: str,
        user_timezone: str,
        task: TaskRecord,
    ) -> Literal["keep_recurrence", "detach_instance"]:
        if task.series_id is None or task.recurrence_frequency is None or task.completed_at is None:
            return "keep_recurrence"

        existing_open = get_open_task_in_series(
            connection,
            user_id=user_id,
            series_id=task.series_id,
            exclude_task_id=task.id,
        )
        if existing_open is None:
            return "detach_instance"

        completed_at = task.completed_at
        if completed_at.tzinfo is None:
            completed_at = completed_at.replace(tzinfo=UTC)

        next_due_date, next_day_of_month = next_due_date_for_completed_task(
            completed_at=completed_at,
            recurrence_frequency=task.recurrence_frequency,
            recurrence_weekday=task.recurrence_weekday,
            recurrence_day_of_month=task.recurrence_day_of_month,
            recurrence_month=task.recurrence_month,
            user_timezone=user_timezone,
        )
        expected_day_of_month = (
            next_day_of_month
            if task.recurrence_frequency in ("monthly", "yearly")
            else task.recurrence_day_of_month
        )

        if (
            existing_open.title == task.title
            and existing_open.group_id == task.group_id
            and existing_open.capture_id is None
            and existing_open.due_date == next_due_date
            and existing_open.reminder_offset_minutes == task.reminder_offset_minutes
            and existing_open.recurrence_frequency == task.recurrence_frequency
            and existing_open.recurrence_interval == task.recurrence_interval
            and existing_open.recurrence_weekday == task.recurrence_weekday
            and existing_open.recurrence_day_of_month == expected_day_of_month
        ):
            update_task(
                connection,
                user_id=user_id,
                task_id=existing_open.id,
                values={"deleted_at": datetime.now(UTC)},
            )
            cancel_reminder(connection, user_id=user_id, task_id=existing_open.id)
            return "keep_recurrence"

        # If another open occurrence exists but doesn't match the expected next occurrence,
        # detach this task from the series so the user can still reopen it
        return "detach_instance"

    def _reconcile_series_on_restore(
        self,
        connection: sa.Connection,
        *,
        user_id: str,
        user_timezone: str,
        task: TaskRecord,
    ) -> Literal["keep_recurrence", "detach_instance"]:
        if (
            task.status != "open"
            or task.deleted_at is None
            or task.series_id is None
            or task.recurrence_frequency is None
        ):
            return "keep_recurrence"

        occurrence_due_date = task.due_date
        if occurrence_due_date is None:
            deleted_at = task.deleted_at
            assert deleted_at is not None
            if deleted_at.tzinfo is None:
                deleted_at = deleted_at.replace(tzinfo=UTC)
            occurrence_due_date = deleted_at.astimezone(ZoneInfo(user_timezone)).date()

        existing_open = get_open_task_in_series(
            connection,
            user_id=user_id,
            series_id=task.series_id,
            exclude_task_id=task.id,
        )
        if existing_open is None:
            return "detach_instance"

        next_due_date, next_day_of_month = next_due_date_for_deleted_occurrence(
            occurrence_due_date=occurrence_due_date,
            recurrence_frequency=task.recurrence_frequency,
            recurrence_weekday=task.recurrence_weekday,
            recurrence_day_of_month=task.recurrence_day_of_month,
            recurrence_month=task.recurrence_month,
        )
        expected_day_of_month = (
            next_day_of_month
            if task.recurrence_frequency in ("monthly", "yearly")
            else task.recurrence_day_of_month
        )

        if (
            existing_open.title == task.title
            and existing_open.group_id == task.group_id
            and existing_open.capture_id is None
            and existing_open.due_date == next_due_date
            and existing_open.reminder_offset_minutes == task.reminder_offset_minutes
            and existing_open.recurrence_frequency == task.recurrence_frequency
            and existing_open.recurrence_interval == task.recurrence_interval
            and existing_open.recurrence_weekday == task.recurrence_weekday
            and existing_open.recurrence_day_of_month == expected_day_of_month
        ):
            update_task(
                connection,
                user_id=user_id,
                task_id=existing_open.id,
                values={"deleted_at": datetime.now(UTC)},
            )
            cancel_reminder(connection, user_id=user_id, task_id=existing_open.id)
            return "keep_recurrence"

        # If another open occurrence exists but doesn't match the expected next occurrence,
        # detach this task from the series so the user can still restore it
        return "detach_instance"

    def _recurrence_reset_values(self, *, task: TaskRecord) -> dict[str, object]:
        if task.recurrence_frequency is None and task.series_id is None:
            return {}
        return {
            "series_id": None,
            "recurrence_frequency": None,
            "recurrence_interval": None,
            "recurrence_weekday": None,
            "recurrence_day_of_month": None,
            "reminder_offset_minutes": None,
        }

    def _ensure_series_id_for_recurring_task(
        self,
        connection: sa.Connection,
        *,
        user_id: str,
        task: TaskRecord,
    ) -> TaskRecord:
        if task.recurrence_frequency is None or task.series_id is not None:
            return task

        updated = update_task(
            connection,
            user_id=user_id,
            task_id=task.id,
            values={"series_id": str(uuid.uuid4())},
        )
        assert updated is not None
        return updated

    def _due_bucket(self, *, task: TaskRecord, user_timezone: str) -> str:
        bucket = due_bucket_for_date(due_date=task.due_date, user_timezone=user_timezone)
        if bucket == "future":
            return "due_soon"
        return bucket

    def _task_sort_key(self, *, item: TaskListItem, user_timezone: str) -> tuple[object, ...]:
        raw_bucket = due_bucket_for_date(due_date=item.task.due_date, user_timezone=user_timezone)
        bucket_rank = {"overdue": 0, "due_soon": 1, "future": 1, "no_date": 2}[raw_bucket]
        urgency_rank = 0 if raw_bucket != "future" else 1
        due_value = item.task.due_date or date.max  # Tasks without dates go to bottom
        created_value = item.task.created_at
        return (
            bucket_rank,
            urgency_rank,
            due_value,
            -created_value.timestamp(),
        )

    def _completed_task_sort_key(self, item: TaskListItem) -> tuple[object, ...]:
        completed_value = item.task.completed_at or item.task.updated_at or item.task.created_at
        return (-completed_value.timestamp(),)
