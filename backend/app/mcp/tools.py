"""Gust MCP tools.

Every tool goes through `_gust_tool`, which:
- rebuilds the principal from the verified bearer token (fails closed without one)
- refuses write tools for read-only tokens
- applies the per-token read or write rate limit
- turns Gust errors into tool errors with the existing sanitized messages
- records denied and failed writes in the audit log (successful writes are recorded by
  AgentOperations, inside the write's own transaction where it matters)
- logs one `mcp_tool_called` line with no titles, descriptions or arguments

Descriptions state facts only, per Meta's connector guidelines.
"""

# No `from __future__ import annotations` here: the MCP SDK reads these signatures at
# registration time to build each tool's JSON schema.

import functools
import logging
import time
from collections.abc import Callable
from datetime import date
from typing import Annotated, Any, Literal, TypeVar

from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations
from pydantic import AwareDatetime, Field, ValidationError

from app.core.errors import ApiError
from app.core.input_safety import MAX_GROUP_DESCRIPTION_CHARS, MAX_TITLE_CHARS
from app.core.rate_limits import RequestRateLimiter
from app.mcp.auth import current_principal
from app.services.agent_access import McpPrincipal
from app.services.agent_models import (
    IDEMPOTENCY_KEY_PATTERN,
    MAX_BATCH_TASKS,
    MAX_SUBTASKS_PER_TASK,
    CompleteTaskResult,
    ContextResult,
    DeletedGroupResult,
    DeletedSubtaskResult,
    DeleteTaskResult,
    GroupListResult,
    GroupWriteResult,
    NewTask,
    Recurrence,
    SubtaskResult,
    TaskBatchResult,
    TaskChanges,
    TaskClearField,
    TaskDetailOut,
    TaskListResult,
    TaskWriteResult,
)
from app.services.agent_operations import DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT, AgentOperations

logger = logging.getLogger("gust.mcp")

ToolKind = Literal["read", "write", "destructive"]
F = TypeVar("F", bound=Callable[..., Any])

READ_ONLY_TOKEN_MESSAGE = (
    "This token is read-only. Create a Read & write token in Gust Settings to make changes."
)
UNEXPECTED_ERROR_MESSAGE = "Unexpected server error. Try again later."

TaskId = Annotated[str, Field(description="Task ID (UUID) from list_tasks or get_task.")]
SubtaskId = Annotated[str, Field(description="Subtask ID (UUID) from get_task.")]
GroupIdArg = Annotated[
    str | None,
    Field(description="Group ID (UUID). Use either group_id or group_name."),
]
GroupNameArg = Annotated[
    str | None,
    Field(description="Group name, matched exactly ignoring case. Use either this or group_id."),
]
IdempotencyKey = Annotated[
    str | None,
    Field(
        pattern=IDEMPOTENCY_KEY_PATTERN,
        description=(
            "Optional, 8-64 characters. Retrying with the same key returns the original "
            "result instead of creating a duplicate."
        ),
    ),
]
DueDateArg = Annotated[date | None, Field(description="Due date, YYYY-MM-DD, user's timezone.")]
ReminderAtArg = Annotated[
    AwareDatetime | None,
    Field(
        description=(
            "Date-and-time reminder, ISO 8601 with a UTC offset, in the future. "
            "Use either reminder_at or reminder_date."
        )
    ),
]
ReminderDateArg = Annotated[
    date | None,
    Field(description="Date-only reminder, YYYY-MM-DD, today or later."),
]
RecurrenceArg = Annotated[
    Recurrence | None,
    Field(description="Repeat rule. Weekly, monthly and yearly repeats need a due date."),
]


def _validation_message(exc: ValidationError) -> str:
    parts: list[str] = []
    for error in exc.errors(include_input=False, include_url=False):
        location = ".".join(str(part) for part in error.get("loc", ()))
        message = str(error.get("msg", "Invalid value.")).removeprefix("Value error, ")
        parts.append(f"{location}: {message}" if location else message)
    return "Invalid arguments: " + "; ".join(parts)


class _ToolRegistrar:
    """Registers Gust tools with the shared guard, error mapping, audit and logging."""

    def __init__(
        self,
        server: MCPServer,
        *,
        operations: AgentOperations,
        rate_limiter: RequestRateLimiter,
    ) -> None:
        self.server = server
        self.operations = operations
        self.rate_limiter = rate_limiter

    def tool(
        self,
        *,
        title: str,
        description: str,
        kind: ToolKind,
        idempotent: bool = False,
    ) -> Callable[[F], F]:
        annotations = ToolAnnotations(
            title=title,
            read_only_hint=kind == "read",
            destructive_hint=kind == "destructive",
            idempotent_hint=idempotent,
            open_world_hint=False,
        )

        def decorator(fn: F) -> F:
            @functools.wraps(fn)
            def wrapper(*args: Any, **kwargs: Any) -> Any:
                return self._invoke(fn, kind != "read", args, kwargs)

            self.server.add_tool(
                wrapper,
                name=fn.__name__,
                title=title,
                description=description,
                annotations=annotations,
            )
            return fn

        return decorator

    def _invoke(
        self,
        fn: Callable[..., Any],
        is_write: bool,
        args: tuple[Any, ...],
        kwargs: dict[str, Any],
    ) -> Any:
        tool_name = fn.__name__
        started = time.perf_counter()
        principal = current_principal()
        outcome, error_code = "ok", None
        try:
            self._guard(principal, is_write)
            return fn(*args, **kwargs)
        except _DeniedError as exc:
            outcome, error_code = "denied", exc.code
            raise ToolError(exc.message) from None
        except ToolError:
            outcome, error_code = "error", "tool_error"
            raise
        except ApiError as exc:
            outcome, error_code = "error", exc.code
            raise ToolError(exc.message) from None
        except ValidationError as exc:
            outcome, error_code = "error", "invalid_arguments"
            raise ToolError(_validation_message(exc)) from None
        except Exception:
            outcome, error_code = "error", "internal_error"
            logger.exception(
                "mcp_tool_failed",
                extra={
                    "event": "mcp_tool_failed",
                    "tool": tool_name,
                    "token_id": principal.token_id,
                },
            )
            raise ToolError(UNEXPECTED_ERROR_MESSAGE) from None
        finally:
            if is_write and error_code is not None:
                self._record_failure(principal, tool_name, outcome, error_code)
            logger.info(
                "mcp_tool_called",
                extra={
                    "event": "mcp_tool_called",
                    "tool": tool_name,
                    "token_id": principal.token_id,
                    "outcome": outcome,
                    "error_code": error_code,
                    "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                },
            )

    def _guard(self, principal: McpPrincipal, is_write: bool) -> None:
        if is_write and not principal.can_write:
            raise _DeniedError("read_only_token", READ_ONLY_TOKEN_MESSAGE)
        limit = self.rate_limiter.evaluate_mcp_token_call(
            token_id=principal.token_id,
            write=is_write,
        )
        if limit.exceeded:
            retry_after = limit.headers.get("Retry-After", "60")
            raise _DeniedError(
                "rate_limit_exceeded",
                f"Rate limit exceeded for this token. Retry in {retry_after} seconds.",
            )

    def _record_failure(
        self,
        principal: McpPrincipal,
        tool_name: str,
        outcome: str,
        error_code: str,
    ) -> None:
        try:
            self.operations.record_failure(
                principal,
                tool_name=tool_name,
                outcome=outcome,
                error_code=error_code,
            )
        except Exception:
            # Never mask the tool's own error, but never drop this silently either.
            logger.exception(
                "mcp_audit_failed",
                extra={"event": "mcp_audit_failed", "tool": tool_name},
            )


class _DeniedError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(code)
        self.code = code
        self.message = message


# One nested definition per tool; each body is a single delegation to AgentOperations.
def register_tools(  # noqa: C901
    server: MCPServer,
    *,
    operations: AgentOperations,
    rate_limiter: RequestRateLimiter,
) -> None:
    _gust_tool = _ToolRegistrar(server, operations=operations, rate_limiter=rate_limiter).tool

    # ----- Read tools ------------------------------------------------------------------

    @_gust_tool(
        title="Get Gust context",
        kind="read",
        idempotent=True,
        description=(
            "Read. Returns the user's timezone, today's date and the current time in that "
            "timezone, whether this token can write, the Inbox group ID, every group with its "
            "open task count, and counts of open tasks that are overdue, due today or flagged "
            "for review. Relative dates such as 'tomorrow' resolve against `today`."
        ),
    )
    def get_context() -> ContextResult:
        return operations.get_context(current_principal())

    @_gust_tool(
        title="List groups",
        kind="read",
        idempotent=True,
        description=(
            "Read. Lists every task group with its description and open and completed task "
            "counts. The Inbox is the system group and cannot be renamed or deleted."
        ),
    )
    def list_groups() -> GroupListResult:
        return operations.list_groups(current_principal())

    @_gust_tool(
        title="List tasks",
        kind="read",
        idempotent=True,
        description=(
            "Read. Lists tasks, newest first within each page, filtered by status (open by "
            "default), group, text search over title and description, due-date range or no due "
            "date, and completion date range for completed tasks. Descriptions are cut to 200 "
            "characters; get_task returns the full task. Deleted tasks are not listed. Returns "
            "next_cursor when more results exist."
        ),
    )
    def list_tasks(
        status: Annotated[
            Literal["open", "completed"],
            Field(description="open (default) or completed."),
        ] = "open",
        group_id: GroupIdArg = None,
        group_name: GroupNameArg = None,
        query: Annotated[
            str | None,
            Field(max_length=200, description="Text to find in task titles and descriptions."),
        ] = None,
        due_start: Annotated[
            date | None,
            Field(description="Only tasks due on or after this date, YYYY-MM-DD."),
        ] = None,
        due_end: Annotated[
            date | None,
            Field(description="Only tasks due on or before this date, YYYY-MM-DD."),
        ] = None,
        no_due_date: Annotated[
            bool,
            Field(description="Only tasks without a due date."),
        ] = False,
        completed_start: Annotated[
            date | None,
            Field(description="With status=completed: completed on or after this date."),
        ] = None,
        completed_end: Annotated[
            date | None,
            Field(description="With status=completed: completed before this date."),
        ] = None,
        limit: Annotated[
            int,
            Field(ge=1, le=MAX_LIST_LIMIT, description=f"Page size, 1-{MAX_LIST_LIMIT}."),
        ] = DEFAULT_LIST_LIMIT,
        cursor: Annotated[
            str | None,
            Field(max_length=512, description="next_cursor from the previous page."),
        ] = None,
    ) -> TaskListResult:
        return operations.list_tasks(
            current_principal(),
            group_id=group_id,
            group_name=group_name,
            status=status,
            query=query,
            due_start=due_start,
            due_end=due_end,
            no_due_date=no_due_date,
            completed_start=completed_start,
            completed_end=completed_end,
            limit=limit,
            cursor=cursor,
        )

    @_gust_tool(
        title="Get task",
        kind="read",
        idempotent=True,
        description=(
            "Read. Returns one task in full: description, group, due date, reminder, "
            "recurrence and subtasks. Also returns deleted tasks, with deleted_at set."
        ),
    )
    def get_task(task_id: TaskId) -> TaskDetailOut:
        return operations.get_task(current_principal(), task_id=task_id)

    # ----- Write tools -----------------------------------------------------------------

    @_gust_tool(
        title="Create task",
        kind="write",
        description=(
            "Write. Creates one task, with optional subtasks, in one step. Without a group it "
            "goes to the Inbox. The task is not flagged for review. Reminders must be in the "
            "future."
        ),
    )
    def create_task(
        title: Annotated[str, Field(min_length=1, max_length=MAX_TITLE_CHARS)],
        description: Annotated[str | None, Field(max_length=2000)] = None,
        group_id: GroupIdArg = None,
        group_name: GroupNameArg = None,
        due_date: DueDateArg = None,
        reminder_at: ReminderAtArg = None,
        reminder_date: ReminderDateArg = None,
        recurrence: RecurrenceArg = None,
        subtasks: Annotated[
            list[str] | None,
            Field(max_length=MAX_SUBTASKS_PER_TASK, description="Up to 20 subtask titles."),
        ] = None,
        idempotency_key: IdempotencyKey = None,
    ) -> TaskWriteResult:
        task = NewTask(
            title=title,
            description=description,
            group_id=group_id,
            group_name=group_name,
            due_date=due_date,
            reminder_at=reminder_at,
            reminder_date=reminder_date,
            recurrence=recurrence,
            subtasks=subtasks or [],
        )
        return operations.create_task(
            current_principal(),
            task=task,
            idempotency_key=idempotency_key,
        )

    @_gust_tool(
        title="Create several tasks",
        kind="write",
        description=(
            f"Write. Creates 1-{MAX_BATCH_TASKS} tasks in one call. All or nothing: every task "
            "is checked first, and if any is invalid nothing is created and each problem is "
            "listed."
        ),
    )
    def create_tasks(
        tasks: Annotated[list[NewTask], Field(min_length=1, max_length=MAX_BATCH_TASKS)],
        idempotency_key: IdempotencyKey = None,
    ) -> TaskBatchResult:
        return operations.create_tasks(
            current_principal(),
            tasks=tasks,
            idempotency_key=idempotency_key,
        )

    @_gust_tool(
        title="Update task",
        kind="write",
        idempotent=True,
        description=(
            "Write. Changes only the fields given; everything else is kept. To remove a value, "
            "list it in `clear` (description, due_date, reminder, recurrence). When the due "
            "date moves, an existing reminder moves with it. If the stored reminder has already "
            "passed and is not being changed, it is removed and the result says so."
        ),
    )
    def update_task(
        task_id: TaskId,
        title: Annotated[str | None, Field(min_length=1, max_length=MAX_TITLE_CHARS)] = None,
        description: Annotated[str | None, Field(max_length=2000)] = None,
        group_id: GroupIdArg = None,
        group_name: GroupNameArg = None,
        due_date: DueDateArg = None,
        reminder_at: ReminderAtArg = None,
        reminder_date: ReminderDateArg = None,
        recurrence: RecurrenceArg = None,
        clear: Annotated[
            list[TaskClearField] | None,
            Field(description="Fields to remove: description, due_date, reminder, recurrence."),
        ] = None,
    ) -> TaskWriteResult:
        changes = TaskChanges(
            title=title,
            description=description,
            group_id=group_id,
            group_name=group_name,
            due_date=due_date,
            reminder_at=reminder_at,
            reminder_date=reminder_date,
            recurrence=recurrence,
            clear=clear or [],
        )
        return operations.update_task(current_principal(), task_id=task_id, changes=changes)

    @_gust_tool(
        title="Complete task",
        kind="write",
        description=(
            "Write. Marks an open task completed. For a recurring task Gust creates the next "
            "occurrence and returns it. Recurring tasks cannot be completed before their due "
            "date."
        ),
    )
    def complete_task(task_id: TaskId) -> CompleteTaskResult:
        return operations.complete_task(current_principal(), task_id=task_id)

    @_gust_tool(
        title="Reopen task",
        kind="write",
        description="Write. Moves a completed task back to open.",
    )
    def reopen_task(task_id: TaskId) -> TaskWriteResult:
        return operations.reopen_task(current_principal(), task_id=task_id)

    @_gust_tool(
        title="Restore task",
        kind="write",
        description="Write. Restores a deleted task so it shows up again.",
    )
    def restore_task(task_id: TaskId) -> TaskWriteResult:
        return operations.restore_task(current_principal(), task_id=task_id)

    @_gust_tool(
        title="Add subtask",
        kind="write",
        description="Write. Adds a subtask to a task.",
    )
    def add_subtask(
        task_id: TaskId,
        title: Annotated[str, Field(min_length=1, max_length=MAX_TITLE_CHARS)],
    ) -> SubtaskResult:
        return operations.add_subtask(current_principal(), task_id=task_id, title=title)

    @_gust_tool(
        title="Update subtask",
        kind="write",
        idempotent=True,
        description="Write. Renames a subtask, ticks it off, or both. Omitted fields are kept.",
    )
    def update_subtask(
        task_id: TaskId,
        subtask_id: SubtaskId,
        title: Annotated[str | None, Field(min_length=1, max_length=MAX_TITLE_CHARS)] = None,
        is_completed: Annotated[bool | None, Field(description="True ticks it off.")] = None,
    ) -> SubtaskResult:
        return operations.update_subtask(
            current_principal(),
            task_id=task_id,
            subtask_id=subtask_id,
            title=title,
            is_completed=is_completed,
        )

    @_gust_tool(
        title="Create group",
        kind="write",
        description="Write. Creates a task group. Group names are unique, ignoring case.",
    )
    def create_group(
        name: Annotated[str, Field(min_length=1, max_length=MAX_TITLE_CHARS)],
        description: Annotated[
            str | None,
            Field(max_length=MAX_GROUP_DESCRIPTION_CHARS),
        ] = None,
        idempotency_key: IdempotencyKey = None,
    ) -> GroupWriteResult:
        return operations.create_group(
            current_principal(),
            name=name,
            description=description,
            idempotency_key=idempotency_key,
        )

    @_gust_tool(
        title="Update group",
        kind="write",
        idempotent=True,
        description=(
            "Write. Renames a group or changes its description. Omitted fields are kept. The "
            "Inbox cannot be changed."
        ),
    )
    def update_group(
        group_id: Annotated[str, Field(description="Group ID (UUID) from list_groups.")],
        name: Annotated[str | None, Field(min_length=1, max_length=MAX_TITLE_CHARS)] = None,
        description: Annotated[
            str | None,
            Field(max_length=MAX_GROUP_DESCRIPTION_CHARS),
        ] = None,
        clear_description: Annotated[
            bool,
            Field(description="True removes the description."),
        ] = False,
    ) -> GroupWriteResult:
        return operations.update_group(
            current_principal(),
            group_id=group_id,
            name=name,
            description=description,
            clear_description=clear_description,
        )

    # ----- Destructive tools -----------------------------------------------------------

    @_gust_tool(
        title="Delete task",
        kind="destructive",
        description=(
            "Deletes a task. This is a soft delete that restore_task undoes. scope=occurrence "
            "(default) deletes this task only; for a recurring task Gust then schedules the "
            "next occurrence. scope=series deletes every open occurrence of a recurring task."
        ),
    )
    def delete_task(
        task_id: TaskId,
        scope: Annotated[
            Literal["occurrence", "series"],
            Field(description="occurrence (default) or series."),
        ] = "occurrence",
    ) -> DeleteTaskResult:
        return operations.delete_task(current_principal(), task_id=task_id, scope=scope)

    @_gust_tool(
        title="Delete subtask",
        kind="destructive",
        description="Permanently deletes a subtask. This cannot be undone.",
    )
    def delete_subtask(task_id: TaskId, subtask_id: SubtaskId) -> DeletedSubtaskResult:
        return operations.delete_subtask(
            current_principal(),
            task_id=task_id,
            subtask_id=subtask_id,
        )

    @_gust_tool(
        title="Delete group",
        kind="destructive",
        description=(
            "Permanently deletes a group. Its tasks move to the group named by "
            "move_tasks_to_group_id or move_tasks_to_group_name, which is required. The Inbox "
            "cannot be deleted. The group itself cannot be restored."
        ),
    )
    def delete_group(
        group_id: Annotated[str, Field(description="ID (UUID) of the group to delete.")],
        move_tasks_to_group_id: Annotated[
            str | None,
            Field(description="ID of the group that receives the tasks."),
        ] = None,
        move_tasks_to_group_name: Annotated[
            str | None,
            Field(description="Name of the group that receives the tasks."),
        ] = None,
    ) -> DeletedGroupResult:
        return operations.delete_group(
            current_principal(),
            group_id=group_id,
            move_tasks_to_group_id=move_tasks_to_group_id,
            move_tasks_to_group_name=move_tasks_to_group_name,
        )
