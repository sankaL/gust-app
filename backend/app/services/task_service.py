from __future__ import annotations

# ruff: noqa: UP045
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Optional

import sqlalchemy as sa

from app.core.errors import (
    ConflictError,
    GroupNotFoundError,
    InvalidSubtaskError,
    InvalidTaskError,
    SubtaskNotFoundError,
    TaskNotFoundError,
)
from app.core.settings import Settings
from app.db.engine import connection_scope
from app.db.repositories import (
    GroupRecord,
    SubtaskRecord,
    TaskRecord,
    bulk_reassign_tasks,
    cancel_reminder,
    create_subtasks,
    create_task,
    create_subtask,
    get_group,
    get_open_task_in_series,
    get_subtask,
    get_task,
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
    normalize_task_fields,
)


@dataclass
class TaskListItem:
    task: TaskRecord
    group: GroupRecord
    due_bucket: str


@dataclass
class TaskDetail:
    task: TaskRecord
    group: GroupRecord
    subtasks: list[SubtaskRecord]


@dataclass
class TaskUpdateInput:
    title: str
    group_id: str
    due_date: Optional[date]
    reminder_at: Optional[datetime]
    recurrence: Optional[RecurrenceInput]


class TaskService:
    def __init__(self, *, settings: Settings) -> None:
        self.settings = settings

    def list_tasks(
        self,
        *,
        user_id: str,
        user_timezone: str,
        group_id: str,
        status: str = "open",
    ) -> list[TaskListItem]:
        with connection_scope(self.settings.database_url) as connection:
            group = get_group(connection, user_id=user_id, group_id=group_id)
            if group is None:
                raise GroupNotFoundError()

            group_lookup = {
                candidate.id: candidate
                for candidate in self._list_groups(connection, user_id=user_id)
            }
            task_rows = list_tasks(
                connection,
                user_id=user_id,
                group_id=group_id,
                status=status,
            )

        items = [
            TaskListItem(
                task=task,
                group=group_lookup[task.group_id],
                due_bucket=self._due_bucket(task=task, user_timezone=user_timezone),
            )
            for task in task_rows
        ]
        items.sort(key=lambda item: self._task_sort_key(item=item, user_timezone=user_timezone))
        return items

    def get_task_detail(self, *, user_id: str, task_id: str) -> TaskDetail:
        with connection_scope(self.settings.database_url) as connection:
            task = get_task(connection, user_id=user_id, task_id=task_id)
            if task is None:
                raise TaskNotFoundError()
            group = get_group(connection, user_id=user_id, group_id=task.group_id)
            if group is None:
                raise GroupNotFoundError("Task group could not be found.")
            task_subtasks = list_subtasks(connection, user_id=user_id, task_id=task_id)
        return TaskDetail(task=task, group=group, subtasks=task_subtasks)

    def update_task(
        self,
        *,
        user_id: str,
        user_timezone: str,
        task_id: str,
        payload: TaskUpdateInput,
    ) -> TaskDetail:
        with connection_scope(self.settings.database_url) as connection:
            existing = get_task(connection, user_id=user_id, task_id=task_id)
            if existing is None:
                raise TaskNotFoundError()
            destination_group = get_group(connection, user_id=user_id, group_id=payload.group_id)
            if destination_group is None:
                raise GroupNotFoundError("Destination group could not be found.")

            normalized = self._normalize_fields(
                title=payload.title,
                due_date=payload.due_date,
                reminder_at=payload.reminder_at,
                recurrence=payload.recurrence,
                user_timezone=user_timezone,
                current_series_id=existing.series_id,
            )

            values: dict[str, object] = {
                "title": normalized.title,
                "group_id": payload.group_id,
                "needs_review": (
                    False
                    if payload.group_id != existing.group_id
                    else existing.needs_review
                ),
                "due_date": normalized.due_date,
                "reminder_at": normalized.reminder_at,
                "reminder_offset_minutes": normalized.reminder_offset_minutes,
                "recurrence_frequency": normalized.recurrence_frequency,
                "recurrence_interval": normalized.recurrence_interval,
                "recurrence_weekday": normalized.recurrence_weekday,
                "recurrence_day_of_month": normalized.recurrence_day_of_month,
                "series_id": normalized.series_id,
            }
            updated = update_task(connection, user_id=user_id, task_id=task_id, values=values)
            assert updated is not None
            self._sync_reminder(
                connection,
                user_id=user_id,
                task=updated,
                now=datetime.now(timezone.utc),
            )
            group = get_group(connection, user_id=user_id, group_id=updated.group_id)
            assert group is not None
            task_subtasks = list_subtasks(connection, user_id=user_id, task_id=task_id)

        return TaskDetail(task=updated, group=group, subtasks=task_subtasks)

    def complete_task(self, *, user_id: str, user_timezone: str, task_id: str) -> TaskDetail:
        with connection_scope(self.settings.database_url) as connection:
            task = get_task(connection, user_id=user_id, task_id=task_id)
            if task is None or task.deleted_at is not None:
                raise TaskNotFoundError()
            completed_at = datetime.now(timezone.utc)
            updated = update_task(
                connection,
                user_id=user_id,
                task_id=task_id,
                values={
                    "status": "completed",
                    "completed_at": completed_at,
                },
            )
            assert updated is not None
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
        with connection_scope(self.settings.database_url) as connection:
            task = get_task(connection, user_id=user_id, task_id=task_id)
            if task is None or task.deleted_at is not None:
                raise TaskNotFoundError()
            self._reconcile_series_on_reopen(
                connection,
                user_id=user_id,
                user_timezone=user_timezone,
                task=task,
            )
            updated = update_task(
                connection,
                user_id=user_id,
                task_id=task_id,
                values={
                    "status": "open",
                    "completed_at": None,
                },
            )
            assert updated is not None
            self._sync_reminder(
                connection,
                user_id=user_id,
                task=updated,
                now=datetime.now(timezone.utc),
            )
            group = get_group(connection, user_id=user_id, group_id=updated.group_id)
            assert group is not None
            task_subtasks = list_subtasks(connection, user_id=user_id, task_id=task_id)
        return TaskDetail(task=updated, group=group, subtasks=task_subtasks)

    def delete_task(self, *, user_id: str, task_id: str) -> TaskDetail:
        with connection_scope(self.settings.database_url) as connection:
            task = get_task(connection, user_id=user_id, task_id=task_id)
            if task is None:
                raise TaskNotFoundError()
            updated = update_task(
                connection,
                user_id=user_id,
                task_id=task_id,
                values={"deleted_at": datetime.now(timezone.utc)},
            )
            assert updated is not None
            cancel_reminder(connection, user_id=user_id, task_id=task_id)
            group = get_group(connection, user_id=user_id, group_id=updated.group_id)
            assert group is not None
            task_subtasks = list_subtasks(connection, user_id=user_id, task_id=task_id)
        return TaskDetail(task=updated, group=group, subtasks=task_subtasks)

    def restore_task(self, *, user_id: str, task_id: str) -> TaskDetail:
        with connection_scope(self.settings.database_url) as connection:
            task = get_task(connection, user_id=user_id, task_id=task_id)
            if task is None:
                raise TaskNotFoundError()
            updated = update_task(
                connection,
                user_id=user_id,
                task_id=task_id,
                values={"deleted_at": None},
            )
            assert updated is not None
            self._sync_reminder(
                connection,
                user_id=user_id,
                task=updated,
                now=datetime.now(timezone.utc),
            )
            group = get_group(connection, user_id=user_id, group_id=updated.group_id)
            assert group is not None
            task_subtasks = list_subtasks(connection, user_id=user_id, task_id=task_id)
        return TaskDetail(task=updated, group=group, subtasks=task_subtasks)

    def create_subtask(self, *, user_id: str, task_id: str, title: str) -> SubtaskRecord:
        normalized_title = title.strip()
        if not normalized_title:
            raise InvalidSubtaskError("Subtask title cannot be blank.")

        with connection_scope(self.settings.database_url) as connection:
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
        title: Optional[str],
        is_completed: Optional[bool],
    ) -> SubtaskRecord:
        if title is None and is_completed is None:
            raise InvalidSubtaskError("At least one subtask field must be provided.")

        with connection_scope(self.settings.database_url) as connection:
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
                normalized_title = title.strip()
                if not normalized_title:
                    raise InvalidSubtaskError("Subtask title cannot be blank.")
                values["title"] = normalized_title
            if is_completed is not None:
                values["is_completed"] = is_completed
                values["completed_at"] = datetime.now(timezone.utc) if is_completed else None

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
        with connection_scope(self.settings.database_url) as connection:
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
        due_date: Optional[date],
        reminder_at: Optional[datetime],
        recurrence: Optional[RecurrenceInput],
        user_timezone: str,
        current_series_id: Optional[str],
    ):
        try:
            return normalize_task_fields(
                title=title,
                due_date=due_date,
                reminder_at=reminder_at,
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
    ) -> None:
        reminder_at = task.reminder_at
        if reminder_at is not None and reminder_at.tzinfo is None:
            reminder_at = reminder_at.replace(tzinfo=timezone.utc)
        if (
            task.deleted_at is not None
            or task.status != "open"
            or reminder_at is None
            or reminder_at <= now
        ):
            cancel_reminder(connection, user_id=user_id, task_id=task.id)
            return
        upsert_reminder(
            connection,
            user_id=user_id,
            task_id=task.id,
            scheduled_for=reminder_at,
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
        if (
            task.series_id is None
            or task.recurrence_frequency is None
            or task.due_date is None
        ):
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
            user_timezone=user_timezone,
        )

        next_reminder_at = None
        if task.reminder_offset_minutes is not None:
            derived_reminder_at = compute_reminder_at_from_offset(
                due_date=next_due_date,
                reminder_offset_minutes=task.reminder_offset_minutes,
                user_timezone=user_timezone,
            ).astimezone(timezone.utc)
            if derived_reminder_at > completed_at:
                next_reminder_at = derived_reminder_at

        next_task = create_task(
            connection,
            user_id=user_id,
            group_id=task.group_id,
            capture_id=None,
            title=task.title,
            needs_review=False,
            due_date=next_due_date,
            reminder_at=next_reminder_at,
            reminder_offset_minutes=task.reminder_offset_minutes,
            recurrence_frequency=task.recurrence_frequency,
            recurrence_interval=task.recurrence_interval,
            recurrence_weekday=task.recurrence_weekday,
            recurrence_day_of_month=(
                next_day_of_month
                if task.recurrence_frequency == "monthly"
                else task.recurrence_day_of_month
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

        self._sync_reminder(connection, user_id=user_id, task=next_task, now=completed_at)

    def _reconcile_series_on_reopen(
        self,
        connection: sa.Connection,
        *,
        user_id: str,
        user_timezone: str,
        task: TaskRecord,
    ) -> None:
        if (
            task.series_id is None
            or task.recurrence_frequency is None
            or task.completed_at is None
            or task.due_date is None
        ):
            return

        existing_open = get_open_task_in_series(
            connection,
            user_id=user_id,
            series_id=task.series_id,
            exclude_task_id=task.id,
        )
        if existing_open is None:
            return

        completed_at = task.completed_at
        if completed_at.tzinfo is None:
            completed_at = completed_at.replace(tzinfo=timezone.utc)

        next_due_date, next_day_of_month = next_due_date_for_completed_task(
            completed_at=completed_at,
            recurrence_frequency=task.recurrence_frequency,
            recurrence_weekday=task.recurrence_weekday,
            recurrence_day_of_month=task.recurrence_day_of_month,
            user_timezone=user_timezone,
        )
        expected_day_of_month = (
            next_day_of_month
            if task.recurrence_frequency == "monthly"
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
                values={"deleted_at": datetime.now(timezone.utc)},
            )
            cancel_reminder(connection, user_id=user_id, task_id=existing_open.id)
            return

        raise ConflictError(
            "task_reopen_conflict",
            "Task cannot be reopened while another open occurrence in this series exists.",
        )

    def _due_bucket(self, *, task: TaskRecord, user_timezone: str) -> str:
        bucket = due_bucket_for_date(due_date=task.due_date, user_timezone=user_timezone)
        if bucket == "future":
            return "due_soon"
        return bucket

    def _task_sort_key(self, *, item: TaskListItem, user_timezone: str) -> tuple[object, ...]:
        raw_bucket = due_bucket_for_date(due_date=item.task.due_date, user_timezone=user_timezone)
        bucket_rank = {"overdue": 0, "due_soon": 1, "future": 1, "no_date": 2}[raw_bucket]
        urgency_rank = 0 if raw_bucket != "future" else 1
        due_value = item.task.due_date or date.max
        created_value = item.task.created_at
        return (
            bucket_rank,
            urgency_rank,
            0 if item.task.needs_review else 1,
            due_value,
            -created_value.timestamp(),
        )
