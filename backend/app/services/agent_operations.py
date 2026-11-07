"""What the MCP tools do, on behalf of one principal.

Everything runs through TaskService and GroupService, so validation, timezone rules, recurrence
and reminder sync match the app. Every query is scoped to `principal.user_id`.

Successful writes are recorded in `mcp_audit_events` here. Creates that take an
`idempotency_key` write their audit row in the same transaction as the create, so the unique
index on (token_id, idempotency_key) is what stops a retried call from creating a duplicate.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from datetime import UTC, date, datetime
from typing import TypeVar
from zoneinfo import ZoneInfo

import sqlalchemy as sa

from app.core.errors import (
    ApiError,
    ConflictError,
    GroupNotFoundError,
    InvalidGroupError,
    InvalidTaskError,
    SubtaskNotFoundError,
    TaskNotFoundError,
)
from app.core.settings import Settings
from app.db.engine import user_connection_scope
from app.db.mcp_repositories import (
    McpAuditEventRecord,
    count_open_task_buckets,
    find_group_by_name,
    find_mcp_audit_event_by_idempotency_key,
    insert_mcp_audit_event,
)
from app.db.repositories import (
    GroupRecord,
    SubtaskRecord,
    TaskRecord,
    get_group,
    get_open_task_in_series,
    list_groups_with_counts,
)
from app.services.agent_access import McpPrincipal
from app.services.agent_models import (
    DESCRIPTION_PREVIEW_CHARS,
    CompleteTaskResult,
    ContextGroup,
    ContextResult,
    DeletedGroupResult,
    DeletedSubtaskResult,
    DeleteTaskResult,
    GroupListResult,
    GroupOut,
    GroupRef,
    GroupWriteResult,
    NewTask,
    OpenTaskCounts,
    Recurrence,
    SubtaskOut,
    SubtaskResult,
    TaskBatchResult,
    TaskChanges,
    TaskDetailOut,
    TaskListResult,
    TaskSummary,
    TaskWriteResult,
    validate_group_description,
    validate_group_name,
)
from app.services.group_service import GroupService, GroupUpdateInput
from app.services.task_rules import RecurrenceInput, due_bucket_for_date
from app.services.task_service import (
    PAST_REMINDER_MESSAGES,
    TaskCreateInput,
    TaskDetail,
    TaskListItem,
    TaskService,
    TaskUpdateInput,
)

logger = logging.getLogger("gust.mcp")

DEFAULT_LIST_LIMIT = 25
MAX_LIST_LIMIT = 50
CLEARED_PAST_REMINDER_NOTE = (
    "The task's reminder had already passed, so it was removed. Set a new reminder to keep one."
)

T = TypeVar("T")


def _require_uuid(value: str, error: ApiError) -> str:
    try:
        return str(uuid.UUID(value.strip()))
    except (AttributeError, ValueError):
        raise error from None


def _invalid_task(message: str) -> InvalidTaskError:
    return InvalidTaskError(message)


class AgentOperations:
    def __init__(self, *, settings: Settings) -> None:
        self.settings = settings
        self.task_service = TaskService(settings=settings)
        self.group_service = GroupService(settings=settings, task_service=self.task_service)

    # ----- Reads -----------------------------------------------------------------------

    def get_context(self, principal: McpPrincipal) -> ContextResult:
        zone = ZoneInfo(principal.timezone)
        now_local = datetime.now(UTC).astimezone(zone)
        with user_connection_scope(
            self.settings.database_url, user_id=principal.user_id
        ) as connection:
            groups = list_groups_with_counts(connection, user_id=principal.user_id)
            counts = count_open_task_buckets(
                connection,
                user_id=principal.user_id,
                today=now_local.date(),
            )
        return ContextResult(
            timezone=principal.timezone,
            today=now_local.date(),
            now=now_local.replace(microsecond=0),
            access="read_write" if principal.can_write else "read",
            inbox_group_id=principal.inbox_group_id,
            groups=[
                ContextGroup(
                    id=group.id,
                    name=group.name,
                    is_system=group.is_system,
                    open_task_count=group.open_task_count,
                )
                for group in groups
            ],
            open_task_counts=OpenTaskCounts(
                overdue=counts.overdue,
                due_today=counts.due_today,
                needs_review=counts.needs_review,
            ),
        )

    def list_groups(self, principal: McpPrincipal) -> GroupListResult:
        groups = self.group_service.list_groups(user_id=principal.user_id)
        return GroupListResult(
            groups=[
                GroupOut(
                    id=group.id,
                    name=group.name,
                    description=group.description,
                    is_system=group.is_system,
                    open_task_count=group.open_task_count,
                    completed_task_count=group.completed_task_count,
                )
                for group in groups
            ]
        )

    def list_tasks(
        self,
        principal: McpPrincipal,
        *,
        group_id: str | None,
        group_name: str | None,
        status: str,
        query: str | None,
        due_start: date | None,
        due_end: date | None,
        no_due_date: bool,
        completed_start: date | None,
        completed_end: date | None,
        limit: int,
        cursor: str | None,
    ) -> TaskListResult:
        if group_id is not None and group_name is not None:
            raise InvalidTaskError("Choose either group_id or group_name, not both.")
        if due_start is not None and due_end is not None and due_start > due_end:
            raise InvalidTaskError("due_start must be on or before due_end.")
        if no_due_date and (due_start is not None or due_end is not None):
            raise InvalidTaskError("no_due_date cannot be combined with due_start or due_end.")
        if status != "completed" and (completed_start is not None or completed_end is not None):
            raise InvalidTaskError("completed_start and completed_end need status `completed`.")

        resolved_group_id: str | None = None
        if group_id is not None or group_name is not None:
            with user_connection_scope(
                self.settings.database_url, user_id=principal.user_id
            ) as connection:
                resolved_group_id = self._resolve_group(
                    connection,
                    principal,
                    group_id=group_id,
                    group_name=group_name,
                    default_to_inbox=False,
                ).id

        result = self.task_service.list_tasks(
            user_id=principal.user_id,
            user_timezone=principal.timezone,
            group_id=resolved_group_id,
            status=status,
            limit=max(1, min(limit, MAX_LIST_LIMIT)),
            cursor=cursor,
            search_query=query,
            completed_start=completed_start,
            completed_end=completed_end,
            due_start=due_start,
            due_end=due_end,
            no_due_date=no_due_date,
        )
        return TaskListResult(
            tasks=[self._summary_from_item(item, principal.timezone) for item in result.items],
            has_more=result.has_more,
            next_cursor=result.next_cursor,
        )

    def get_task(self, principal: McpPrincipal, *, task_id: str) -> TaskDetailOut:
        detail = self.task_service.get_task_detail(
            user_id=principal.user_id,
            task_id=_require_uuid(task_id, TaskNotFoundError()),
        )
        return self._detail(detail, principal.timezone)

    # ----- Task writes -----------------------------------------------------------------

    def create_task(
        self,
        principal: McpPrincipal,
        *,
        task: NewTask,
        idempotency_key: str | None,
    ) -> TaskWriteResult:
        def replay(event: McpAuditEventRecord) -> TaskWriteResult:
            if event.tool_name != "create_task" or event.target_id is None:
                raise _idempotency_key_reused()
            detail = self.task_service.get_task_detail(
                user_id=principal.user_id,
                task_id=event.target_id,
            )
            return TaskWriteResult(task=self._detail(detail, principal.timezone), replayed=True)

        def create(connection: sa.Connection) -> TaskWriteResult:
            detail = self._create_one(connection, principal, task)
            self._record_ok(
                connection,
                principal,
                tool_name="create_task",
                target_type="task",
                target_id=detail.task.id,
                idempotency_key=idempotency_key,
            )
            return TaskWriteResult(task=self._detail(detail, principal.timezone))

        return self._idempotent(principal, idempotency_key, replay=replay, create=create)

    def create_tasks(
        self,
        principal: McpPrincipal,
        *,
        tasks: list[NewTask],
        idempotency_key: str | None,
    ) -> TaskBatchResult:
        if not tasks:
            raise InvalidTaskError("Provide at least one task.")

        def replay(event: McpAuditEventRecord) -> TaskBatchResult:
            if event.tool_name != "create_tasks" or not event.target_ids:
                raise _idempotency_key_reused()
            details = [
                self.task_service.get_task_detail(user_id=principal.user_id, task_id=task_id)
                for task_id in event.target_ids
            ]
            return TaskBatchResult(
                tasks=[self._detail(detail, principal.timezone) for detail in details],
                replayed=True,
            )

        def create(connection: sa.Connection) -> TaskBatchResult:
            # Check every item before writing any, so one bad item creates nothing and the
            # agent gets every problem back at once.
            problems: list[str] = []
            for index, item in enumerate(tasks, start=1):
                try:
                    group = self._resolve_group(
                        connection,
                        principal,
                        group_id=item.group_id,
                        group_name=item.group_name,
                        default_to_inbox=True,
                    )
                    del group
                    self.task_service.validate_task_fields(
                        title=item.title,
                        due_date=item.due_date,
                        reminder_at=item.reminder_at,
                        reminder_date=item.reminder_date,
                        recurrence=_recurrence_input(item.recurrence),
                        user_timezone=principal.timezone,
                    )
                except ApiError as exc:
                    problems.append(f"Task {index}: {exc.message}")
            if problems:
                raise InvalidTaskError(
                    "Nothing was created. " + " ".join(problems),
                )

            details = [self._create_one(connection, principal, item) for item in tasks]
            self._record_ok(
                connection,
                principal,
                tool_name="create_tasks",
                target_type="task",
                target_ids=[detail.task.id for detail in details],
                idempotency_key=idempotency_key,
            )
            return TaskBatchResult(
                tasks=[self._detail(detail, principal.timezone) for detail in details],
            )

        return self._idempotent(principal, idempotency_key, replay=replay, create=create)

    def update_task(
        self,
        principal: McpPrincipal,
        *,
        task_id: str,
        changes: TaskChanges,
    ) -> TaskWriteResult:
        if not changes.has_changes():
            raise InvalidTaskError("Provide at least one field to change or clear.")
        normalized_id = _require_uuid(task_id, TaskNotFoundError())
        existing = self.task_service.get_task_detail(
            user_id=principal.user_id,
            task_id=normalized_id,
        )
        if existing.task.deleted_at is not None:
            raise InvalidTaskError("Deleted tasks cannot be edited. Restore the task first.")

        with user_connection_scope(
            self.settings.database_url, user_id=principal.user_id
        ) as connection:
            group_id = existing.task.group_id
            if changes.group_id is not None or changes.group_name is not None:
                group_id = self._resolve_group(
                    connection,
                    principal,
                    group_id=changes.group_id,
                    group_name=changes.group_name,
                    default_to_inbox=False,
                ).id

        payload = _merge_task_changes(existing.task, changes, group_id=group_id)
        notes: list[str] = []
        try:
            detail = self.task_service.update_task(
                user_id=principal.user_id,
                user_timezone=principal.timezone,
                task_id=normalized_id,
                payload=payload,
            )
        except InvalidTaskError as exc:
            # The stored reminder may have passed since it was set. Gust rejects a past
            # reminder on every save, so an untouched one would block an unrelated edit
            # such as a rename. Drop it, retry once, and say so.
            if not _reminder_untouched(changes) or exc.message not in PAST_REMINDER_MESSAGES:
                raise
            payload = _merge_task_changes(
                existing.task,
                changes.model_copy(update={"clear": [*changes.clear, "reminder"]}),
                group_id=group_id,
            )
            detail = self.task_service.update_task(
                user_id=principal.user_id,
                user_timezone=principal.timezone,
                task_id=normalized_id,
                payload=payload,
            )
            notes.append(CLEARED_PAST_REMINDER_NOTE)

        self._record_ok_now(
            principal, tool_name="update_task", target_type="task", target_id=normalized_id
        )
        return TaskWriteResult(task=self._detail(detail, principal.timezone), notes=notes)

    def complete_task(self, principal: McpPrincipal, *, task_id: str) -> CompleteTaskResult:
        normalized_id = _require_uuid(task_id, TaskNotFoundError())
        detail = self.task_service.complete_task(
            user_id=principal.user_id,
            user_timezone=principal.timezone,
            task_id=normalized_id,
        )
        next_occurrence: TaskSummary | None = None
        if detail.task.series_id is not None:
            with user_connection_scope(
                self.settings.database_url, user_id=principal.user_id
            ) as connection:
                next_task = get_open_task_in_series(
                    connection,
                    user_id=principal.user_id,
                    series_id=detail.task.series_id,
                    exclude_task_id=normalized_id,
                )
                next_group = (
                    get_group(connection, user_id=principal.user_id, group_id=next_task.group_id)
                    if next_task is not None
                    else None
                )
            if next_task is not None and next_group is not None:
                next_occurrence = self._summary(next_task, next_group, principal.timezone)
        self._record_ok_now(
            principal, tool_name="complete_task", target_type="task", target_id=normalized_id
        )
        return CompleteTaskResult(
            task=self._detail(detail, principal.timezone),
            next_occurrence=next_occurrence,
        )

    def reopen_task(self, principal: McpPrincipal, *, task_id: str) -> TaskWriteResult:
        normalized_id = _require_uuid(task_id, TaskNotFoundError())
        detail = self.task_service.reopen_task(
            user_id=principal.user_id,
            user_timezone=principal.timezone,
            task_id=normalized_id,
        )
        self._record_ok_now(
            principal, tool_name="reopen_task", target_type="task", target_id=normalized_id
        )
        return TaskWriteResult(task=self._detail(detail, principal.timezone))

    def restore_task(self, principal: McpPrincipal, *, task_id: str) -> TaskWriteResult:
        normalized_id = _require_uuid(task_id, TaskNotFoundError())
        detail = self.task_service.restore_task(
            user_id=principal.user_id,
            user_timezone=principal.timezone,
            task_id=normalized_id,
        )
        self._record_ok_now(
            principal, tool_name="restore_task", target_type="task", target_id=normalized_id
        )
        return TaskWriteResult(task=self._detail(detail, principal.timezone))

    def delete_task(
        self,
        principal: McpPrincipal,
        *,
        task_id: str,
        scope: str,
    ) -> DeleteTaskResult:
        if scope not in {"occurrence", "series"}:
            raise InvalidTaskError("scope must be `occurrence` or `series`.")
        normalized_id = _require_uuid(task_id, TaskNotFoundError())
        detail = self.task_service.delete_task(
            user_id=principal.user_id,
            user_timezone=principal.timezone,
            task_id=normalized_id,
            scope=scope,
        )
        self._record_ok_now(
            principal, tool_name="delete_task", target_type="task", target_id=normalized_id
        )
        note = f"Moved to deleted. Undo with restore_task(task_id={normalized_id!r})."
        if scope == "series":
            note = (
                "Every open occurrence in this series was moved to deleted. "
                f"restore_task(task_id={normalized_id!r}) restores this one occurrence."
            )
        return DeleteTaskResult(task=self._detail(detail, principal.timezone), note=note)

    # ----- Subtasks --------------------------------------------------------------------

    def add_subtask(self, principal: McpPrincipal, *, task_id: str, title: str) -> SubtaskResult:
        normalized_id = _require_uuid(task_id, TaskNotFoundError())
        subtask = self.task_service.create_subtask(
            user_id=principal.user_id,
            task_id=normalized_id,
            title=title,
        )
        self._record_ok_now(
            principal, tool_name="add_subtask", target_type="subtask", target_id=subtask.id
        )
        return SubtaskResult(task_id=normalized_id, subtask=_subtask_out(subtask))

    def update_subtask(
        self,
        principal: McpPrincipal,
        *,
        task_id: str,
        subtask_id: str,
        title: str | None,
        is_completed: bool | None,
    ) -> SubtaskResult:
        normalized_task_id = _require_uuid(task_id, TaskNotFoundError())
        normalized_subtask_id = _require_uuid(subtask_id, SubtaskNotFoundError())
        subtask = self.task_service.update_subtask(
            user_id=principal.user_id,
            task_id=normalized_task_id,
            subtask_id=normalized_subtask_id,
            title=title,
            is_completed=is_completed,
        )
        self._record_ok_now(
            principal,
            tool_name="update_subtask",
            target_type="subtask",
            target_id=normalized_subtask_id,
        )
        return SubtaskResult(task_id=normalized_task_id, subtask=_subtask_out(subtask))

    def delete_subtask(
        self,
        principal: McpPrincipal,
        *,
        task_id: str,
        subtask_id: str,
    ) -> DeletedSubtaskResult:
        normalized_task_id = _require_uuid(task_id, TaskNotFoundError())
        normalized_subtask_id = _require_uuid(subtask_id, SubtaskNotFoundError())
        self.task_service.delete_subtask(
            user_id=principal.user_id,
            task_id=normalized_task_id,
            subtask_id=normalized_subtask_id,
        )
        self._record_ok_now(
            principal,
            tool_name="delete_subtask",
            target_type="subtask",
            target_id=normalized_subtask_id,
        )
        return DeletedSubtaskResult(
            task_id=normalized_task_id,
            subtask_id=normalized_subtask_id,
            deleted=True,
        )

    # ----- Groups ----------------------------------------------------------------------

    def create_group(
        self,
        principal: McpPrincipal,
        *,
        name: str,
        description: str | None,
        idempotency_key: str | None,
    ) -> GroupWriteResult:
        def replay(event: McpAuditEventRecord) -> GroupWriteResult:
            if event.tool_name != "create_group" or event.target_id is None:
                raise _idempotency_key_reused()
            with user_connection_scope(
                self.settings.database_url, user_id=principal.user_id
            ) as connection:
                group = get_group(connection, user_id=principal.user_id, group_id=event.target_id)
            if group is None:
                raise GroupNotFoundError("The group created with this idempotency_key is gone.")
            return GroupWriteResult(
                group=_group_ref(group),
                description=group.description,
                replayed=True,
            )

        def create(connection: sa.Connection) -> GroupWriteResult:
            group = self.group_service.create_group_in_transaction(
                connection,
                user_id=principal.user_id,
                name=name,
                description=description,
            )
            self._record_ok(
                connection,
                principal,
                tool_name="create_group",
                target_type="group",
                target_id=group.id,
                idempotency_key=idempotency_key,
            )
            return GroupWriteResult(group=_group_ref(group), description=group.description)

        return self._idempotent(principal, idempotency_key, replay=replay, create=create)

    def update_group(
        self,
        principal: McpPrincipal,
        *,
        group_id: str,
        name: str | None,
        description: str | None,
        clear_description: bool,
    ) -> GroupWriteResult:
        if description is not None and clear_description:
            raise InvalidGroupError("Cannot both set and clear the description.")
        normalized_id = _require_uuid(group_id, GroupNotFoundError())
        try:
            normalized_name = validate_group_name(name) if name is not None else None
            normalized_description = validate_group_description(description)
        except ValueError as exc:
            raise InvalidGroupError(str(exc)) from exc
        group = self.group_service.update_group(
            user_id=principal.user_id,
            group_id=normalized_id,
            payload=GroupUpdateInput(
                name=normalized_name,
                description=None if clear_description else normalized_description,
                description_provided=clear_description or description is not None,
            ),
        )
        self._record_ok_now(
            principal, tool_name="update_group", target_type="group", target_id=normalized_id
        )
        return GroupWriteResult(group=_group_ref(group), description=group.description)

    def delete_group(
        self,
        principal: McpPrincipal,
        *,
        group_id: str,
        move_tasks_to_group_id: str | None,
        move_tasks_to_group_name: str | None,
    ) -> DeletedGroupResult:
        if move_tasks_to_group_id is None and move_tasks_to_group_name is None:
            raise InvalidGroupError(
                "Name the group that should receive this group's tasks: "
                "move_tasks_to_group_id or move_tasks_to_group_name."
            )
        normalized_id = _require_uuid(group_id, GroupNotFoundError())
        with user_connection_scope(
            self.settings.database_url, user_id=principal.user_id
        ) as connection:
            destination = self._resolve_group(
                connection,
                principal,
                group_id=move_tasks_to_group_id,
                group_name=move_tasks_to_group_name,
                default_to_inbox=False,
            )
        self.group_service.delete_group(
            user_id=principal.user_id,
            group_id=normalized_id,
            destination_group_id=destination.id,
        )
        self._record_ok_now(
            principal, tool_name="delete_group", target_type="group", target_id=normalized_id
        )
        return DeletedGroupResult(
            deleted_group_id=normalized_id, tasks_moved_to=_group_ref(destination)
        )

    # ----- Audit -----------------------------------------------------------------------

    def record_failure(
        self,
        principal: McpPrincipal,
        *,
        tool_name: str,
        outcome: str,
        error_code: str,
    ) -> None:
        """Record a denied or failed write. Called by the tool layer."""
        with user_connection_scope(
            self.settings.database_url, user_id=principal.user_id
        ) as connection:
            insert_mcp_audit_event(
                connection,
                user_id=principal.user_id,
                token_id=principal.token_id,
                tool_name=tool_name,
                outcome=outcome,
                error_code=error_code[:64],
                created_at=datetime.now(UTC),
            )

    # ----- Helpers ---------------------------------------------------------------------

    def _idempotent(
        self,
        principal: McpPrincipal,
        idempotency_key: str | None,
        *,
        replay: Callable[[McpAuditEventRecord], T],
        create: Callable[[sa.Connection], T],
    ) -> T:
        if idempotency_key is not None:
            previous = self._find_idempotent_event(principal, idempotency_key)
            if previous is not None:
                return replay(previous)
        try:
            with user_connection_scope(
                self.settings.database_url, user_id=principal.user_id
            ) as connection:
                return create(connection)
        except (sa.exc.IntegrityError, ConflictError):
            # A concurrent retry with the same key committed first. Its row is the result.
            # create_group surfaces that race as a name ConflictError rather than an
            # IntegrityError, because the group's unique name is checked before the key.
            if idempotency_key is None:
                raise
            previous = self._find_idempotent_event(principal, idempotency_key)
            if previous is None:
                raise
            return replay(previous)

    def _find_idempotent_event(
        self,
        principal: McpPrincipal,
        idempotency_key: str,
    ) -> McpAuditEventRecord | None:
        with user_connection_scope(
            self.settings.database_url, user_id=principal.user_id
        ) as connection:
            return find_mcp_audit_event_by_idempotency_key(
                connection,
                user_id=principal.user_id,
                token_id=principal.token_id,
                idempotency_key=idempotency_key,
            )

    def _create_one(
        self,
        connection: sa.Connection,
        principal: McpPrincipal,
        task: NewTask,
    ) -> TaskDetail:
        group = self._resolve_group(
            connection,
            principal,
            group_id=task.group_id,
            group_name=task.group_name,
            default_to_inbox=True,
        )
        return self.task_service.create_task_in_transaction(
            connection,
            user_id=principal.user_id,
            user_timezone=principal.timezone,
            payload=TaskCreateInput(
                title=task.title,
                description=task.description,
                group_id=group.id,
                due_date=task.due_date,
                reminder_at=task.reminder_at,
                reminder_date=task.reminder_date,
                recurrence=_recurrence_input(task.recurrence),
            ),
            subtask_titles=task.subtasks,
        )

    def _resolve_group(
        self,
        connection: sa.Connection,
        principal: McpPrincipal,
        *,
        group_id: str | None,
        group_name: str | None,
        default_to_inbox: bool,
    ) -> GroupRecord:
        if group_id is not None and group_name is not None:
            raise InvalidTaskError("Choose either group_id or group_name, not both.")
        if group_id is None and group_name is None:
            if not default_to_inbox:
                raise InvalidTaskError("A group_id or group_name is required.")
            group_id = principal.inbox_group_id
        if group_name is not None:
            found_id = find_group_by_name(connection, user_id=principal.user_id, name=group_name)
            if found_id is None:
                raise GroupNotFoundError(
                    "No group has that name. Call list_groups to see the exact names."
                )
            group_id = found_id
        assert group_id is not None
        normalized_id = _require_uuid(group_id, GroupNotFoundError())
        group = get_group(connection, user_id=principal.user_id, group_id=normalized_id)
        if group is None:
            raise GroupNotFoundError()
        return group

    def _record_ok(
        self,
        connection: sa.Connection,
        principal: McpPrincipal,
        *,
        tool_name: str,
        target_type: str,
        target_id: str | None = None,
        target_ids: list[str] | None = None,
        idempotency_key: str | None = None,
    ) -> None:
        insert_mcp_audit_event(
            connection,
            user_id=principal.user_id,
            token_id=principal.token_id,
            tool_name=tool_name,
            outcome="ok",
            target_type=target_type,
            target_id=target_id,
            target_ids=target_ids,
            idempotency_key=idempotency_key,
            created_at=datetime.now(UTC),
        )

    def _record_ok_now(
        self,
        principal: McpPrincipal,
        *,
        tool_name: str,
        target_type: str,
        target_id: str,
    ) -> None:
        # The write has already committed. If its audit row cannot be written, the agent must
        # still get the result: an error here would invite a retry that duplicates the write.
        try:
            with user_connection_scope(
                self.settings.database_url, user_id=principal.user_id
            ) as connection:
                self._record_ok(
                    connection,
                    principal,
                    tool_name=tool_name,
                    target_type=target_type,
                    target_id=target_id,
                )
        except Exception:
            logger.exception(
                "mcp_audit_failed",
                extra={"event": "mcp_audit_failed", "tool": tool_name},
            )

    def _summary_from_item(self, item: TaskListItem, user_timezone: str) -> TaskSummary:
        summary = self._summary(item.task, item.group, user_timezone)
        summary.subtask_count = item.subtask_count
        return summary

    @staticmethod
    def _summary(task: TaskRecord, group: GroupRecord, user_timezone: str) -> TaskSummary:
        description = task.description
        preview = None
        if description:
            preview = (
                description
                if len(description) <= DESCRIPTION_PREVIEW_CHARS
                else description[: DESCRIPTION_PREVIEW_CHARS - 1].rstrip() + "…"
            )
        return TaskSummary(
            id=task.id,
            title=task.title,
            description_preview=preview,
            status=task.status,
            needs_review=task.needs_review,
            due_date=task.due_date,
            due_bucket=due_bucket_for_date(due_date=task.due_date, user_timezone=user_timezone),
            reminder_at=task.reminder_at,
            reminder_date=task.reminder_date,
            recurrence_frequency=task.recurrence_frequency,
            group=_group_ref(group),
            subtask_count=getattr(task, "subtask_count", 0) or 0,
            completed_at=task.completed_at,
            deleted_at=task.deleted_at,
        )

    @staticmethod
    def _detail(detail: TaskDetail, user_timezone: str) -> TaskDetailOut:
        task = detail.task
        recurrence = None
        if task.recurrence_frequency is not None:
            recurrence = Recurrence(
                frequency=task.recurrence_frequency,
                weekday=task.recurrence_weekday,
                day_of_month=task.recurrence_day_of_month,
                month=task.recurrence_month,
            )
        return TaskDetailOut(
            id=task.id,
            title=task.title,
            description=task.description,
            status=task.status,
            needs_review=task.needs_review,
            due_date=task.due_date,
            due_bucket=due_bucket_for_date(due_date=task.due_date, user_timezone=user_timezone),
            reminder_at=task.reminder_at,
            reminder_date=task.reminder_date,
            recurrence=recurrence,
            series_id=task.series_id,
            group=_group_ref(detail.group),
            subtasks=[_subtask_out(subtask) for subtask in detail.subtasks],
            completed_at=task.completed_at,
            deleted_at=task.deleted_at,
            created_at=task.created_at,
            updated_at=task.updated_at,
        )


def _idempotency_key_reused() -> InvalidTaskError:
    return InvalidTaskError("This idempotency_key was already used for a different call.")


def _group_ref(group: GroupRecord) -> GroupRef:
    return GroupRef(id=group.id, name=group.name, is_system=group.is_system)


def _subtask_out(subtask: SubtaskRecord) -> SubtaskOut:
    return SubtaskOut(
        id=subtask.id,
        title=subtask.title,
        is_completed=subtask.is_completed,
        completed_at=subtask.completed_at,
    )


def _recurrence_input(value: Recurrence | None) -> RecurrenceInput | None:
    if value is None:
        return None
    return RecurrenceInput(
        frequency=value.frequency,
        weekday=value.weekday,
        day_of_month=value.day_of_month,
        month=value.month,
    )


def _reminder_untouched(changes: TaskChanges) -> bool:
    return (
        changes.reminder_at is None
        and changes.reminder_date is None
        and "reminder" not in changes.clear
    )


def _merge_task_changes(
    existing: TaskRecord,
    changes: TaskChanges,
    *,
    group_id: str,
) -> TaskUpdateInput:
    """Turn a partial change set into the full replacement TaskService.update_task expects."""
    cleared = set(changes.clear)

    description = existing.description
    description_provided = False
    if "description" in cleared:
        description, description_provided = None, True
    elif changes.description is not None:
        description, description_provided = changes.description, True

    due_date = existing.due_date
    if "due_date" in cleared:
        due_date = None
    elif changes.due_date is not None:
        due_date = changes.due_date

    reminder_at, reminder_at_provided, reminder_date, reminder_date_provided = _merge_reminder(
        existing, changes, cleared
    )

    recurrence = None
    if "recurrence" not in cleared:
        if changes.recurrence is not None:
            recurrence = _recurrence_input(changes.recurrence)
        elif existing.recurrence_frequency is not None:
            recurrence = RecurrenceInput(
                frequency=existing.recurrence_frequency,
                weekday=existing.recurrence_weekday,
                day_of_month=existing.recurrence_day_of_month,
                month=existing.recurrence_month,
            )

    return TaskUpdateInput(
        title=changes.title if changes.title is not None else existing.title,
        description=description,
        description_provided=description_provided,
        group_id=group_id,
        due_date=due_date,
        reminder_at=reminder_at,
        reminder_at_provided=reminder_at_provided,
        reminder_date=reminder_date,
        reminder_date_provided=reminder_date_provided,
        recurrence=recurrence,
    )


def _merge_reminder(
    existing: TaskRecord,
    changes: TaskChanges,
    cleared: set[str],
) -> tuple[datetime | None, bool, date | None, bool]:
    """Return (reminder_at, reminder_at_provided, reminder_date, reminder_date_provided)."""
    if "reminder" in cleared:
        return None, True, None, True
    if changes.reminder_at is not None:
        return changes.reminder_at, True, None, True
    if changes.reminder_date is not None:
        return None, True, changes.reminder_date, True
    # Untouched: pass the stored reminder through. The service shifts it to the new due date
    # only when an overdue or due-today task moves to a future date (BUG-88); otherwise it
    # stays where it is.
    return _aware(existing.reminder_at), False, existing.reminder_date, False


def _aware(value: datetime | None) -> datetime | None:
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=UTC)
