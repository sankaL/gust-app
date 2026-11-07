"""Typed inputs and outputs for agent (MCP) operations.

Inputs reuse the same plain-text validators and length limits as the REST request models.
Outputs are compact: list results carry a description preview, `get_task` the full text.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import AwareDatetime, BaseModel, Field, field_validator, model_validator

from app.core.input_safety import (
    MAX_GROUP_DESCRIPTION_CHARS,
    MAX_TASK_DESCRIPTION_CHARS,
    MAX_TITLE_CHARS,
    validate_optional_plain_text,
    validate_plain_text,
)

DESCRIPTION_PREVIEW_CHARS = 200
MAX_SUBTASKS_PER_TASK = 20
MAX_BATCH_TASKS = 20
MAX_IDEMPOTENCY_KEY_CHARS = 64
IDEMPOTENCY_KEY_PATTERN = r"^[A-Za-z0-9._:-]{8,64}$"

RecurrenceFrequency = Literal["daily", "weekly", "monthly", "yearly"]
TaskClearField = Literal["description", "due_date", "reminder", "recurrence"]


class Recurrence(BaseModel):
    frequency: RecurrenceFrequency
    weekday: int | None = Field(
        default=None,
        ge=0,
        le=6,
        description="Weekly only: 0 = Sunday, 1 = Monday, ... 6 = Saturday.",
    )
    day_of_month: int | None = Field(
        default=None,
        ge=1,
        le=31,
        description="Monthly and yearly only: day of the month, 1-31.",
    )
    month: int | None = Field(
        default=None,
        ge=1,
        le=12,
        description="Yearly only: month, 1-12.",
    )


class GroupRef(BaseModel):
    id: str
    name: str
    is_system: bool


class SubtaskOut(BaseModel):
    id: str
    title: str
    is_completed: bool
    completed_at: datetime | None


class TaskSummary(BaseModel):
    id: str
    title: str
    description_preview: str | None = Field(
        default=None,
        description=f"First {DESCRIPTION_PREVIEW_CHARS} characters of the description.",
    )
    status: str
    needs_review: bool
    due_date: date | None
    due_bucket: str = Field(description="overdue, due_soon (within 3 days), future or no_date.")
    reminder_at: datetime | None
    reminder_date: date | None
    recurrence_frequency: str | None
    group: GroupRef
    subtask_count: int
    completed_at: datetime | None
    deleted_at: datetime | None = None


class TaskDetailOut(BaseModel):
    id: str
    title: str
    description: str | None
    status: str
    needs_review: bool
    due_date: date | None
    due_bucket: str
    reminder_at: datetime | None
    reminder_date: date | None
    recurrence: Recurrence | None
    series_id: str | None
    group: GroupRef
    subtasks: list[SubtaskOut]
    completed_at: datetime | None
    deleted_at: datetime | None
    created_at: datetime
    updated_at: datetime


class TaskListResult(BaseModel):
    tasks: list[TaskSummary]
    has_more: bool
    next_cursor: str | None = Field(
        default=None,
        description="Pass as `cursor` to fetch the next page.",
    )


class GroupOut(BaseModel):
    id: str
    name: str
    description: str | None
    is_system: bool
    open_task_count: int
    completed_task_count: int


class GroupListResult(BaseModel):
    groups: list[GroupOut]


class ContextGroup(BaseModel):
    id: str
    name: str
    is_system: bool
    open_task_count: int


class OpenTaskCounts(BaseModel):
    overdue: int
    due_today: int
    needs_review: int


class ContextResult(BaseModel):
    timezone: str
    today: date = Field(description="Today's date in the user's timezone.")
    now: datetime = Field(description="The current time in the user's timezone.")
    access: Literal["read", "read_write"]
    inbox_group_id: str
    groups: list[ContextGroup]
    open_task_counts: OpenTaskCounts


class TaskWriteResult(BaseModel):
    task: TaskDetailOut
    replayed: bool = Field(
        default=False,
        description="True when this idempotency_key was already used and nothing new was created.",
    )
    notes: list[str] = Field(default_factory=list)


class TaskBatchResult(BaseModel):
    tasks: list[TaskDetailOut]
    replayed: bool = False


class CompleteTaskResult(BaseModel):
    task: TaskDetailOut
    next_occurrence: TaskSummary | None = Field(
        default=None,
        description="For a recurring task, the next open occurrence Gust created.",
    )


class DeleteTaskResult(BaseModel):
    task: TaskDetailOut
    restorable: bool = True
    note: str


class SubtaskResult(BaseModel):
    task_id: str
    subtask: SubtaskOut


class DeletedSubtaskResult(BaseModel):
    task_id: str
    subtask_id: str
    deleted: bool


class GroupWriteResult(BaseModel):
    group: GroupRef
    description: str | None
    replayed: bool = False


class DeletedGroupResult(BaseModel):
    deleted_group_id: str
    tasks_moved_to: GroupRef


class NewTask(BaseModel):
    """One task to create. Used by create_task and by each item of create_tasks."""

    title: str = Field(min_length=1, max_length=MAX_TITLE_CHARS)
    description: str | None = Field(default=None, max_length=MAX_TASK_DESCRIPTION_CHARS)
    group_id: str | None = Field(
        default=None,
        description="Destination group ID. Omit both group_id and group_name to use the Inbox.",
    )
    group_name: str | None = Field(
        default=None,
        description="Destination group name, matched exactly ignoring case.",
    )
    due_date: date | None = Field(default=None, description="YYYY-MM-DD in the user's timezone.")
    reminder_at: AwareDatetime | None = Field(
        default=None,
        description="Date-and-time reminder, ISO 8601 with a UTC offset. Must be in the future.",
    )
    reminder_date: date | None = Field(
        default=None,
        description="Date-only reminder, YYYY-MM-DD. Cannot be in the past.",
    )
    recurrence: Recurrence | None = Field(
        default=None,
        description="Repeat rule. Weekly, monthly and yearly need a due_date.",
    )
    subtasks: list[str] = Field(
        default_factory=list,
        max_length=MAX_SUBTASKS_PER_TASK,
        description=f"Up to {MAX_SUBTASKS_PER_TASK} subtask titles.",
    )

    @field_validator("title")
    @classmethod
    def _validate_title(cls, value: str) -> str:
        normalized = validate_plain_text(value, field_name="Task title", max_length=MAX_TITLE_CHARS)
        if not normalized:
            raise ValueError("Task title cannot be blank.")
        return normalized

    @field_validator("description")
    @classmethod
    def _validate_description(cls, value: str | None) -> str | None:
        return validate_optional_plain_text(
            value,
            field_name="Task description",
            max_length=MAX_TASK_DESCRIPTION_CHARS,
        )

    @field_validator("subtasks")
    @classmethod
    def _validate_subtasks(cls, value: list[str]) -> list[str]:
        normalized: list[str] = []
        for title in value:
            cleaned = validate_plain_text(
                title,
                field_name="Subtask title",
                max_length=MAX_TITLE_CHARS,
            )
            if not cleaned:
                raise ValueError("Subtask titles cannot be blank.")
            normalized.append(cleaned)
        return normalized

    @model_validator(mode="after")
    def _validate_choices(self) -> NewTask:
        if self.reminder_at is not None and self.reminder_date is not None:
            raise ValueError("Choose either reminder_at or reminder_date, not both.")
        if self.group_id is not None and self.group_name is not None:
            raise ValueError("Choose either group_id or group_name, not both.")
        return self


class TaskChanges(BaseModel):
    """A partial task update. Omitted fields keep their current value."""

    title: str | None = Field(default=None, min_length=1, max_length=MAX_TITLE_CHARS)
    description: str | None = Field(default=None, max_length=MAX_TASK_DESCRIPTION_CHARS)
    group_id: str | None = None
    group_name: str | None = None
    due_date: date | None = None
    reminder_at: AwareDatetime | None = None
    reminder_date: date | None = None
    recurrence: Recurrence | None = None
    clear: list[TaskClearField] = Field(default_factory=list)

    @field_validator("title")
    @classmethod
    def _validate_title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = validate_plain_text(value, field_name="Task title", max_length=MAX_TITLE_CHARS)
        if not normalized:
            raise ValueError("Task title cannot be blank.")
        return normalized

    @field_validator("description")
    @classmethod
    def _validate_description(cls, value: str | None) -> str | None:
        return validate_optional_plain_text(
            value,
            field_name="Task description",
            max_length=MAX_TASK_DESCRIPTION_CHARS,
        )

    @model_validator(mode="after")
    def _validate_choices(self) -> TaskChanges:
        if self.reminder_at is not None and self.reminder_date is not None:
            raise ValueError("Choose either reminder_at or reminder_date, not both.")
        if self.group_id is not None and self.group_name is not None:
            raise ValueError("Choose either group_id or group_name, not both.")
        cleared = set(self.clear)
        conflicts = [
            name
            for name, is_set in (
                ("description", self.description is not None),
                ("due_date", self.due_date is not None),
                ("reminder", self.reminder_at is not None or self.reminder_date is not None),
                ("recurrence", self.recurrence is not None),
            )
            if is_set and name in cleared
        ]
        if conflicts:
            raise ValueError(f"Cannot both set and clear: {', '.join(conflicts)}.")
        return self

    def has_changes(self) -> bool:
        return bool(
            self.clear
            or any(
                value is not None
                for value in (
                    self.title,
                    self.description,
                    self.group_id,
                    self.group_name,
                    self.due_date,
                    self.reminder_at,
                    self.reminder_date,
                    self.recurrence,
                )
            )
        )


def validate_group_name(value: str) -> str:
    normalized = validate_plain_text(value, field_name="Group name", max_length=MAX_TITLE_CHARS)
    if not normalized:
        raise ValueError("Group name cannot be blank.")
    return normalized


def validate_group_description(value: str | None) -> str | None:
    return validate_optional_plain_text(
        value,
        field_name="Group description",
        max_length=MAX_GROUP_DESCRIPTION_CHARS,
    )
