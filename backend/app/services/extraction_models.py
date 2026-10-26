"""Pydantic models for extraction output validation."""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class ExtractionAlternativeGroup(BaseModel):
    """Alternative group suggestion with confidence score."""

    model_config = ConfigDict(extra="forbid")

    group_id: str | None = None
    group_name: str | None = None
    confidence: float = Field(ge=0.0, le=1.0)


class ExtractionRecurrence(BaseModel):
    """Recurrence configuration for a task."""

    model_config = ConfigDict(extra="forbid")

    # Keep recurrence validation at candidate-normalization time so a single
    # malformed recurrence does not fail the whole extraction payload.
    frequency: str
    weekday: int | None = None
    day_of_month: int | None = None
    month: int | None = None


class ExtractionSubtask(BaseModel):
    """Subtask extracted from transcript."""

    model_config = ConfigDict(extra="forbid")

    title: str


class ExtractedTaskCandidate(BaseModel):
    """Single task candidate extracted from transcript."""

    model_config = ConfigDict(extra="forbid")

    title: str
    description: str | None = None
    due_date: date | None = None
    reminder_at: datetime | None = None
    reminder_date: date | None = None
    group_id: str | None = None
    group_name: str | None = None
    top_confidence: float = Field(default=0.9, ge=0.0, le=1.0)
    alternative_groups: list[ExtractionAlternativeGroup] = Field(default_factory=list)
    recurrence: ExtractionRecurrence | None = None
    subtasks: list[ExtractionSubtask] = Field(default_factory=list)


class ExtractorPayload(BaseModel):
    """Complete extraction payload with list of task candidates."""

    model_config = ConfigDict(extra="forbid")

    tasks: list[ExtractedTaskCandidate]
