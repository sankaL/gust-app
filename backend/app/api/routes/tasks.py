from __future__ import annotations

# ruff: noqa: UP045
from datetime import date, datetime
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, field_validator

from app.core.dependencies import get_current_session_context, get_task_service, require_csrf
from app.core.input_safety import (
    MAX_TASK_DESCRIPTION_CHARS,
    MAX_TITLE_CHARS,
    validate_optional_plain_text,
    validate_plain_text,
)
from app.core.errors import InvalidTaskError
from app.db.repositories import SessionContext, SubtaskRecord, TaskRecord
from app.services.task_rules import RecurrenceInput, due_bucket_for_date
from app.services.task_service import (
    TaskCreateInput,
    TaskDetail,
    TaskListItem,
    TaskService,
    TaskUpdateInput,
)

router = APIRouter()

TaskServiceDep = Annotated[TaskService, Depends(get_task_service)]
OptionalSessionContextDep = Annotated[SessionContext, Depends(get_current_session_context)]
RequiredSessionContextDep = Annotated[SessionContext, Depends(require_csrf)]


class GroupSummaryResponse(BaseModel):
    id: str
    name: str
    is_system: bool


class RecurrenceResponse(BaseModel):
    frequency: str
    weekday: Optional[int] = None
    day_of_month: Optional[int] = None


class SubtaskResponse(BaseModel):
    id: str
    title: str
    is_completed: bool
    completed_at: Optional[datetime]


class TaskSummaryResponse(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    series_id: Optional[str] = None
    recurrence_frequency: Optional[str] = None
    status: str
    needs_review: bool
    due_date: Optional[date]
    reminder_at: Optional[datetime]
    due_bucket: str
    group: GroupSummaryResponse
    completed_at: Optional[datetime]
    deleted_at: Optional[datetime]
    subtask_count: int = 0


class TaskDetailResponse(TaskSummaryResponse):
    recurrence: Optional[RecurrenceResponse]
    subtasks: list[SubtaskResponse]


class UpdateTaskRequest(BaseModel):
    title: str
    description: Optional[str] = None
    group_id: str
    due_date: Optional[date] = None
    reminder_at: Optional[datetime] = None
    recurrence: Optional[RecurrenceResponse] = None

    @field_validator("title")
    @classmethod
    def _validate_title(cls, value: str) -> str:
        return validate_plain_text(value, field_name="Task title", max_length=MAX_TITLE_CHARS)

    @field_validator("description")
    @classmethod
    def _validate_description(cls, value: Optional[str]) -> Optional[str]:
        return validate_optional_plain_text(
            value,
            field_name="Task description",
            max_length=MAX_TASK_DESCRIPTION_CHARS,
        )


class CreateTaskRequest(BaseModel):
    title: str
    description: Optional[str] = None
    group_id: str
    due_date: Optional[date] = None
    reminder_at: Optional[datetime] = None
    recurrence: Optional[RecurrenceResponse] = None

    @field_validator("title")
    @classmethod
    def _validate_title(cls, value: str) -> str:
        return validate_plain_text(value, field_name="Task title", max_length=MAX_TITLE_CHARS)

    @field_validator("description")
    @classmethod
    def _validate_description(cls, value: Optional[str]) -> Optional[str]:
        return validate_optional_plain_text(
            value,
            field_name="Task description",
            max_length=MAX_TASK_DESCRIPTION_CHARS,
        )


class CreateSubtaskRequest(BaseModel):
    title: str

    @field_validator("title")
    @classmethod
    def _validate_title(cls, value: str) -> str:
        return validate_plain_text(value, field_name="Subtask title", max_length=MAX_TITLE_CHARS)


class UpdateSubtaskRequest(BaseModel):
    title: Optional[str] = None
    is_completed: Optional[bool] = None

    @field_validator("title")
    @classmethod
    def _validate_title(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return validate_plain_text(value, field_name="Subtask title", max_length=MAX_TITLE_CHARS)


class PaginatedTaskListResponse(BaseModel):
    items: list[TaskSummaryResponse]
    has_more: bool
    next_cursor: Optional[str]


@router.get("", response_model=PaginatedTaskListResponse)
def list_tasks_route(
    session_context: OptionalSessionContextDep,
    task_service: TaskServiceDep,
    group_id: Optional[str] = Query(None),
    status_value: str = Query("open", alias="status"),
    limit: int = Query(50, ge=1, le=100),
    cursor: Optional[str] = Query(None),
) -> PaginatedTaskListResponse:
    validated_status = _validate_status(status_value)
    result = task_service.list_tasks(
        user_id=session_context.user.id,
        user_timezone=session_context.user.timezone,
        group_id=group_id,
        status=validated_status,
        limit=limit,
        cursor=cursor,
    )
    return PaginatedTaskListResponse(
        items=[_build_task_summary(item) for item in result.items],
        has_more=result.has_more,
        next_cursor=result.next_cursor,
    )


@router.post("", response_model=TaskDetailResponse, status_code=status.HTTP_201_CREATED)
def create_task_route(
    payload: CreateTaskRequest,
    session_context: RequiredSessionContextDep,
    task_service: TaskServiceDep,
) -> TaskDetailResponse:
    detail = task_service.create_task(
        user_id=session_context.user.id,
        user_timezone=session_context.user.timezone,
        payload=TaskCreateInput(
            title=payload.title,
            description=payload.description,
            group_id=payload.group_id,
            due_date=payload.due_date,
            reminder_at=payload.reminder_at,
            recurrence=_build_recurrence_input(payload.recurrence),
        ),
    )
    return _build_task_detail(detail, session_context.user.timezone)


@router.get("/{task_id}", response_model=TaskDetailResponse)
def get_task_route(
    task_id: str,
    session_context: OptionalSessionContextDep,
    task_service: TaskServiceDep,
) -> TaskDetailResponse:
    detail = task_service.get_task_detail(user_id=session_context.user.id, task_id=task_id)
    return _build_task_detail(detail, session_context.user.timezone)


@router.patch("/{task_id}", response_model=TaskDetailResponse)
def update_task_route(
    task_id: str,
    payload: UpdateTaskRequest,
    session_context: RequiredSessionContextDep,
    task_service: TaskServiceDep,
) -> TaskDetailResponse:
    detail = task_service.update_task(
        user_id=session_context.user.id,
        user_timezone=session_context.user.timezone,
        task_id=task_id,
        payload=TaskUpdateInput(
            title=payload.title,
            description=payload.description,
            description_provided="description" in payload.model_fields_set,
            group_id=payload.group_id,
            due_date=payload.due_date,
            reminder_at=payload.reminder_at,
            recurrence=_build_recurrence_input(payload.recurrence),
        ),
    )
    return _build_task_detail(detail, session_context.user.timezone)


@router.post("/{task_id}/complete", response_model=TaskDetailResponse)
def complete_task_route(
    task_id: str,
    session_context: RequiredSessionContextDep,
    task_service: TaskServiceDep,
) -> TaskDetailResponse:
    detail = task_service.complete_task(
        user_id=session_context.user.id,
        user_timezone=session_context.user.timezone,
        task_id=task_id,
    )
    return _build_task_detail(detail, session_context.user.timezone)


@router.post("/{task_id}/reopen", response_model=TaskDetailResponse)
def reopen_task_route(
    task_id: str,
    session_context: RequiredSessionContextDep,
    task_service: TaskServiceDep,
) -> TaskDetailResponse:
    detail = task_service.reopen_task(
        user_id=session_context.user.id,
        user_timezone=session_context.user.timezone,
        task_id=task_id,
    )
    return _build_task_detail(detail, session_context.user.timezone)


@router.delete("/{task_id}", response_model=TaskDetailResponse)
def delete_task_route(
    task_id: str,
    session_context: RequiredSessionContextDep,
    task_service: TaskServiceDep,
    scope: str = Query("occurrence"),
) -> TaskDetailResponse:
    validated_scope = _validate_delete_scope(scope)
    detail = task_service.delete_task(
        user_id=session_context.user.id,
        user_timezone=session_context.user.timezone,
        task_id=task_id,
        scope=validated_scope,
    )
    return _build_task_detail(detail, session_context.user.timezone)


@router.post("/{task_id}/restore", response_model=TaskDetailResponse)
def restore_task_route(
    task_id: str,
    session_context: RequiredSessionContextDep,
    task_service: TaskServiceDep,
) -> TaskDetailResponse:
    detail = task_service.restore_task(
        user_id=session_context.user.id,
        user_timezone=session_context.user.timezone,
        task_id=task_id,
    )
    return _build_task_detail(detail, session_context.user.timezone)


@router.post(
    "/{task_id}/subtasks",
    response_model=SubtaskResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_subtask_route(
    task_id: str,
    payload: CreateSubtaskRequest,
    session_context: RequiredSessionContextDep,
    task_service: TaskServiceDep,
) -> SubtaskResponse:
    subtask = task_service.create_subtask(
        user_id=session_context.user.id,
        task_id=task_id,
        title=payload.title,
    )
    return _build_subtask(subtask)


@router.patch("/{task_id}/subtasks/{subtask_id}", response_model=SubtaskResponse)
def update_subtask_route(
    task_id: str,
    subtask_id: str,
    payload: UpdateSubtaskRequest,
    session_context: RequiredSessionContextDep,
    task_service: TaskServiceDep,
) -> SubtaskResponse:
    subtask = task_service.update_subtask(
        user_id=session_context.user.id,
        task_id=task_id,
        subtask_id=subtask_id,
        title=payload.title,
        is_completed=payload.is_completed,
    )
    return _build_subtask(subtask)


@router.delete("/{task_id}/subtasks/{subtask_id}", response_model=dict[str, bool])
def delete_subtask_route(
    task_id: str,
    subtask_id: str,
    session_context: RequiredSessionContextDep,
    task_service: TaskServiceDep,
) -> dict[str, bool]:
    task_service.delete_subtask(
        user_id=session_context.user.id,
        task_id=task_id,
        subtask_id=subtask_id,
    )
    return {"deleted": True}


def _validate_status(value: str) -> str:
    if value not in {"open", "completed"}:
        raise InvalidTaskError("Task status filter must be `open` or `completed`.")
    return value


def _validate_delete_scope(value: str) -> str:
    if value not in {"occurrence", "series"}:
        raise InvalidTaskError("Delete scope must be `occurrence` or `series`.")
    return value


def _build_task_summary(item: TaskListItem) -> TaskSummaryResponse:
    return TaskSummaryResponse(
        id=item.task.id,
        title=item.task.title,
        description=item.task.description,
        series_id=item.task.series_id,
        recurrence_frequency=item.task.recurrence_frequency,
        status=item.task.status,
        needs_review=item.task.needs_review,
        due_date=item.task.due_date,
        reminder_at=item.task.reminder_at,
        due_bucket=item.due_bucket,
        group=GroupSummaryResponse(
            id=item.group.id,
            name=item.group.name,
            is_system=item.group.is_system,
        ),
        completed_at=item.task.completed_at,
        deleted_at=item.task.deleted_at,
        subtask_count=item.subtask_count,
    )


def _build_task_detail(detail: TaskDetail, user_timezone: str) -> TaskDetailResponse:
    due_bucket = due_bucket_for_date(due_date=detail.task.due_date, user_timezone=user_timezone)
    if due_bucket == "future":
        due_bucket = "due_soon"
    return TaskDetailResponse(
        id=detail.task.id,
        title=detail.task.title,
        description=detail.task.description,
        series_id=detail.task.series_id,
        recurrence_frequency=detail.task.recurrence_frequency,
        status=detail.task.status,
        needs_review=detail.task.needs_review,
        due_date=detail.task.due_date,
        reminder_at=detail.task.reminder_at,
        due_bucket=due_bucket,
        group=GroupSummaryResponse(
            id=detail.group.id,
            name=detail.group.name,
            is_system=detail.group.is_system,
        ),
        completed_at=detail.task.completed_at,
        deleted_at=detail.task.deleted_at,
        recurrence=_build_recurrence_response(detail.task),
        subtasks=[_build_subtask(subtask) for subtask in detail.subtasks],
    )


def _build_recurrence_input(value: RecurrenceResponse | None) -> RecurrenceInput | None:
    if value is None:
        return None
    return RecurrenceInput(
        frequency=value.frequency,
        weekday=value.weekday,
        day_of_month=value.day_of_month,
    )


def _build_recurrence_response(task: TaskRecord) -> RecurrenceResponse | None:
    if task.recurrence_frequency is None:
        return None
    return RecurrenceResponse(
        frequency=task.recurrence_frequency,
        weekday=task.recurrence_weekday,
        day_of_month=task.recurrence_day_of_month,
    )


def _build_subtask(subtask: SubtaskRecord) -> SubtaskResponse:
    return SubtaskResponse(
        id=subtask.id,
        title=subtask.title,
        is_completed=subtask.is_completed,
        completed_at=subtask.completed_at,
    )
