from __future__ import annotations

# ruff: noqa: UP037, UP045
import logging
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional, Protocol
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.core.errors import (
    CaptureNotFoundError,
    CaptureStateConflictError,
    ExtractionFailedError,
    InvalidCaptureError,
    TranscriptionFailedError,
)
from app.core.settings import Settings
from app.db.engine import connection_scope
from app.db.repositories import (
    CaptureRecord,
    GroupContextRecord,
    GroupRecord,
    create_capture,
    create_reminder,
    create_subtasks,
    create_task,
    ensure_inbox_group,
    get_capture,
    get_user,
    list_groups_with_recent_tasks,
    update_capture,
)
from app.services.extraction import (
    ExtractionRequest,
    ExtractionServiceError,
    ExtractorMalformedResponseError,
)
from app.services.transcription import TranscriptionServiceError

logger = logging.getLogger("gust.api")


class TranscriptionClient(Protocol):
    async def transcribe(
        self,
        *,
        audio_bytes: bytes,
        filename: str,
        content_type: str,
    ): ...


class ExtractionClient(Protocol):
    async def extract(
        self,
        *,
        request: ExtractionRequest,
        schema: dict[str, object],
    ) -> dict[str, object]: ...


class ExtractionAlternativeGroup(BaseModel):
    model_config = ConfigDict(extra="forbid")

    group_id: Optional[str] = None
    group_name: Optional[str] = None
    confidence: float = Field(ge=0.0, le=1.0)


class ExtractionRecurrence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    frequency: str
    weekday: Optional[int] = None
    day_of_month: Optional[int] = None


class ExtractionSubtask(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str


class ExtractedTaskCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    due_date: Optional[date] = None
    reminder_at: Optional[datetime] = None
    group_id: Optional[str] = None
    group_name: Optional[str] = None
    top_confidence: float = Field(ge=0.0, le=1.0)
    alternative_groups: list[ExtractionAlternativeGroup] = Field(default_factory=list)
    recurrence: Optional[ExtractionRecurrence] = None
    subtasks: list[ExtractionSubtask] = Field(default_factory=list)


class ExtractorPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tasks: list[ExtractedTaskCandidate]


@dataclass
class ReviewCaptureResult:
    capture_id: str
    status: str
    transcript_text: str


@dataclass
class SkippedTaskItem:
    code: str
    message: str
    title: Optional[str]


@dataclass
class SubmitCaptureResult:
    capture_id: str
    status: str
    tasks_created_count: int
    tasks_flagged_for_review_count: int
    tasks_skipped_count: int
    zero_actionable: bool
    skipped_items: list[SkippedTaskItem]


@dataclass
class PreparedTask:
    title: str
    group_id: str
    needs_review: bool
    due_date: Optional[date]
    reminder_at: Optional[datetime]
    reminder_offset_minutes: Optional[int]
    recurrence_frequency: Optional[str]
    recurrence_interval: Optional[int]
    recurrence_weekday: Optional[int]
    recurrence_day_of_month: Optional[int]
    subtasks: list[str]


class CandidateValidationError(Exception):
    def __init__(self, code: str, message: str, title: Optional[str]) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.title = title


class CaptureService:
    def __init__(
        self,
        *,
        settings: Settings,
        transcription_service: TranscriptionClient,
        extraction_service: ExtractionClient,
    ) -> None:
        self.settings = settings
        self.transcription_service = transcription_service
        self.extraction_service = extraction_service

    async def create_voice_capture(
        self,
        *,
        user_id: str,
        audio_bytes: bytes,
        filename: str,
        content_type: str,
    ) -> ReviewCaptureResult:
        if not audio_bytes:
            raise InvalidCaptureError("Audio upload cannot be empty.")
        if not content_type.startswith("audio/"):
            raise InvalidCaptureError("Uploaded file must be audio.")

        capture = self._create_capture(
            user_id=user_id,
            input_type="voice",
            status="pending_transcription",
        )

        try:
            transcription = await self.transcription_service.transcribe(
                audio_bytes=audio_bytes,
                filename=filename,
                content_type=content_type,
            )
        except Exception as exc:
            self._mark_capture_failure(
                capture_id=capture.id,
                user_id=user_id,
                status="transcription_failed",
                error_code=self._error_code_for_exception(exc),
            )
            raise self._map_transcription_error(exc) from exc

        with connection_scope(self.settings.database_url) as connection:
            updated = update_capture(
                connection,
                user_id=user_id,
                capture_id=capture.id,
                status="ready_for_review",
                transcript_text=self._normalize_transcript_text(transcription.transcript_text),
                transcription_provider=transcription.provider,
                transcription_latency_ms=transcription.latency_ms,
                error_code=None,
            )

        assert updated is not None
        logger.info(
            "capture_transcribed",
            extra={
                "event": "capture_transcribed",
                "capture_id": updated.id,
                "user_id": user_id,
            },
        )
        return ReviewCaptureResult(
            capture_id=updated.id,
            status=updated.status,
            transcript_text=updated.transcript_text or "",
        )

    async def create_text_capture(self, *, user_id: str, text: str) -> ReviewCaptureResult:
        normalized = self._normalize_transcript_text(text)
        if not normalized:
            raise InvalidCaptureError("Text capture cannot be empty.")

        capture = self._create_capture(
            user_id=user_id,
            input_type="text",
            status="ready_for_review",
            source_text=normalized,
            transcript_text=normalized,
        )
        return ReviewCaptureResult(
            capture_id=capture.id,
            status=capture.status,
            transcript_text=capture.transcript_text or normalized,
        )

    async def submit_capture(
        self,
        *,
        user_id: str,
        capture_id: str,
        transcript_text: str,
    ) -> SubmitCaptureResult:
        normalized_transcript = self._normalize_transcript_text(transcript_text)
        if not normalized_transcript:
            raise InvalidCaptureError("Transcript cannot be empty.")

        with connection_scope(self.settings.database_url) as connection:
            capture = get_capture(connection, user_id=user_id, capture_id=capture_id)
            if capture is None:
                raise CaptureNotFoundError()
            if capture.status not in {"ready_for_review", "extraction_failed"}:
                raise CaptureStateConflictError()
            user = get_user(connection, user_id)
            if user is None:
                raise CaptureNotFoundError("Authenticated user could not be resolved.")
            inbox_group = ensure_inbox_group(connection, user_id=user_id)
            groups = list_groups_with_recent_tasks(connection, user_id=user_id)

        extraction_request = ExtractionRequest(
            transcript_text=normalized_transcript,
            user_timezone=user.timezone,
            current_local_date=datetime.now(ZoneInfo(user.timezone)).date(),
            groups=[self._group_context_payload(group) for group in groups],
        )

        attempts = 0
        extractor_payload: Optional[ExtractorPayload] = None
        while attempts < 2:
            attempts += 1
            try:
                raw_payload = await self.extraction_service.extract(
                    request=extraction_request,
                    schema=ExtractorPayload.model_json_schema(),
                )
                extractor_payload = ExtractorPayload.model_validate(raw_payload)
                break
            except (ExtractorMalformedResponseError, ValidationError) as exc:
                if attempts >= 2:
                    self._mark_capture_failure(
                        capture_id=capture_id,
                        user_id=user_id,
                        status="extraction_failed",
                        error_code="extractor_payload_invalid",
                        extraction_attempt_count=attempts,
                        transcript_edited_text=normalized_transcript,
                    )
                    raise ExtractionFailedError() from exc
            except Exception as exc:
                self._mark_capture_failure(
                    capture_id=capture_id,
                    user_id=user_id,
                    status="extraction_failed",
                    error_code=self._error_code_for_exception(exc),
                    extraction_attempt_count=attempts,
                    transcript_edited_text=normalized_transcript,
                )
                raise self._map_extraction_error(exc) from exc

        assert extractor_payload is not None

        skipped_items: list[SkippedTaskItem] = []
        prepared_tasks: list[PreparedTask] = []
        groups_by_id = {group.id: group for group in groups}
        groups_by_name = {group.name.lower(): group for group in groups}

        for candidate in extractor_payload.tasks:
            try:
                prepared_tasks.append(
                    self._prepare_task(
                        candidate=candidate,
                        inbox_group=inbox_group,
                        groups_by_id=groups_by_id,
                        groups_by_name=groups_by_name,
                        user_timezone=user.timezone,
                    )
                )
            except CandidateValidationError as exc:
                skipped_items.append(
                    SkippedTaskItem(code=exc.code, message=exc.message, title=exc.title)
                )

        created_count = 0
        flagged_count = 0
        with connection_scope(self.settings.database_url) as connection:
            current_capture = get_capture(connection, user_id=user_id, capture_id=capture_id)
            if current_capture is None:
                raise CaptureNotFoundError()
            if current_capture.status not in {"ready_for_review", "extraction_failed"}:
                raise CaptureStateConflictError()

            submitted_capture = update_capture(
                connection,
                user_id=user_id,
                capture_id=capture_id,
                status="submitted",
                transcript_edited_text=normalized_transcript,
                error_code=None,
            )
            assert submitted_capture is not None

            for prepared in prepared_tasks:
                task = create_task(
                    connection,
                    user_id=user_id,
                    group_id=prepared.group_id,
                    capture_id=capture_id,
                    title=prepared.title,
                    needs_review=prepared.needs_review,
                    due_date=prepared.due_date,
                    reminder_at=prepared.reminder_at,
                    reminder_offset_minutes=prepared.reminder_offset_minutes,
                    recurrence_frequency=prepared.recurrence_frequency,
                    recurrence_interval=prepared.recurrence_interval,
                    recurrence_weekday=prepared.recurrence_weekday,
                    recurrence_day_of_month=prepared.recurrence_day_of_month,
                )
                if prepared.subtasks:
                    create_subtasks(
                        connection,
                        user_id=user_id,
                        task_id=task.id,
                        titles=prepared.subtasks,
                    )
                if prepared.reminder_at is not None:
                    create_reminder(
                        connection,
                        user_id=user_id,
                        task_id=task.id,
                        scheduled_for=prepared.reminder_at,
                    )
                created_count += 1
                if task.needs_review:
                    flagged_count += 1

            final_capture = update_capture(
                connection,
                user_id=user_id,
                capture_id=capture_id,
                status="completed",
                transcript_edited_text=normalized_transcript,
                extraction_attempt_count=attempts,
                tasks_created_count=created_count,
                tasks_skipped_count=len(skipped_items),
                error_code=None,
            )

        assert final_capture is not None
        return SubmitCaptureResult(
            capture_id=capture_id,
            status=final_capture.status,
            tasks_created_count=created_count,
            tasks_flagged_for_review_count=flagged_count,
            tasks_skipped_count=len(skipped_items),
            zero_actionable=created_count == 0,
            skipped_items=skipped_items,
        )

    def _create_capture(
        self,
        *,
        user_id: str,
        input_type: str,
        status: str,
        source_text: Optional[str] = None,
        transcript_text: Optional[str] = None,
    ) -> CaptureRecord:
        expires_at = datetime.now(timezone.utc) + timedelta(
            days=self.settings.capture_retention_days
        )
        with connection_scope(self.settings.database_url) as connection:
            return create_capture(
                connection,
                user_id=user_id,
                input_type=input_type,
                status=status,
                source_text=source_text,
                transcript_text=transcript_text,
                expires_at=expires_at,
            )

    def _mark_capture_failure(
        self,
        *,
        capture_id: str,
        user_id: str,
        status: str,
        error_code: str,
        extraction_attempt_count: Optional[int] = None,
        transcript_edited_text: Optional[str] = None,
    ) -> None:
        with connection_scope(self.settings.database_url) as connection:
            update_capture(
                connection,
                user_id=user_id,
                capture_id=capture_id,
                status=status,
                error_code=error_code,
                extraction_attempt_count=extraction_attempt_count,
                transcript_edited_text=transcript_edited_text,
            )

    def _prepare_task(
        self,
        *,
        candidate: ExtractedTaskCandidate,
        inbox_group: GroupRecord,
        groups_by_id: dict[str, GroupContextRecord],
        groups_by_name: dict[str, GroupContextRecord],
        user_timezone: str,
    ) -> PreparedTask:
        if not candidate.title.strip():
            raise CandidateValidationError(
                "invalid_title",
                "Task title cannot be blank.",
                candidate.title,
            )
        if candidate.reminder_at is not None and candidate.reminder_at.tzinfo is None:
            raise CandidateValidationError(
                "invalid_reminder",
                "Reminder timestamp must include a timezone.",
                candidate.title,
            )

        if candidate.reminder_at is not None and candidate.due_date is None:
            raise CandidateValidationError(
                "reminder_requires_due_date",
                "Reminder requires a due date.",
                candidate.title,
            )

        if candidate.recurrence is not None:
            self._validate_recurrence(candidate)

        for subtask in candidate.subtasks:
            if not subtask.title.strip():
                raise CandidateValidationError(
                    "invalid_subtask",
                    "Subtask title cannot be blank.",
                    candidate.title,
                )

        resolved_group = self._resolve_candidate_group(
            candidate=candidate,
            inbox_group=inbox_group,
            groups_by_id=groups_by_id,
            groups_by_name=groups_by_name,
        )
        tie_detected = self._has_tie(candidate)

        if tie_detected or candidate.top_confidence < 0.5:
            group_id = inbox_group.id
            needs_review = True
        elif resolved_group is None:
            group_id = inbox_group.id
            needs_review = True
        elif candidate.top_confidence >= 0.8:
            group_id = resolved_group.id
            needs_review = False
        else:
            group_id = resolved_group.id
            needs_review = True

        reminder_offset_minutes: Optional[int] = None
        if candidate.reminder_at is not None and candidate.due_date is not None:
            reminder_offset_minutes = self._compute_reminder_offset_minutes(
                due_date=candidate.due_date,
                reminder_at=candidate.reminder_at,
                user_timezone=user_timezone,
            )

        recurrence_frequency: Optional[str] = None
        recurrence_interval: Optional[int] = None
        recurrence_weekday: Optional[int] = None
        recurrence_day_of_month: Optional[int] = None
        if candidate.recurrence is not None:
            recurrence_frequency = candidate.recurrence.frequency
            recurrence_interval = 1
            recurrence_weekday = candidate.recurrence.weekday
            recurrence_day_of_month = candidate.recurrence.day_of_month

        subtasks = [subtask.title for subtask in candidate.subtasks]
        return PreparedTask(
            title=candidate.title.strip(),
            group_id=group_id,
            needs_review=needs_review,
            due_date=candidate.due_date,
            reminder_at=candidate.reminder_at,
            reminder_offset_minutes=reminder_offset_minutes,
            recurrence_frequency=recurrence_frequency,
            recurrence_interval=recurrence_interval,
            recurrence_weekday=recurrence_weekday,
            recurrence_day_of_month=recurrence_day_of_month,
            subtasks=[subtask.strip() for subtask in subtasks],
        )

    def _resolve_candidate_group(
        self,
        *,
        candidate: ExtractedTaskCandidate,
        inbox_group: GroupRecord,
        groups_by_id: dict[str, GroupContextRecord],
        groups_by_name: dict[str, GroupContextRecord],
    ) -> Optional[GroupContextRecord]:
        if candidate.group_id:
            return groups_by_id.get(candidate.group_id)

        if candidate.group_name:
            return groups_by_name.get(candidate.group_name.strip().lower())

        if inbox_group.system_key == "inbox":
            return None

        return None

    def _has_tie(self, candidate: ExtractedTaskCandidate) -> bool:
        if candidate.top_confidence < 0.5:
            return False
        for alternative in candidate.alternative_groups:
            confidence_gap = abs(candidate.top_confidence - alternative.confidence)
            if alternative.confidence >= 0.5 and confidence_gap <= 0.1:
                return True
        return False

    def _validate_recurrence(self, candidate: ExtractedTaskCandidate) -> None:
        assert candidate.recurrence is not None
        recurrence = candidate.recurrence
        if recurrence.frequency == "daily":
            if recurrence.weekday is None and recurrence.day_of_month is None:
                return
        elif recurrence.frequency == "weekly":
            if recurrence.weekday is not None and 0 <= recurrence.weekday <= 6:
                if recurrence.day_of_month is None:
                    return
        elif recurrence.frequency == "monthly":
            if recurrence.day_of_month is not None and 1 <= recurrence.day_of_month <= 31:
                if recurrence.weekday is None:
                    return

        raise CandidateValidationError(
            "invalid_recurrence",
            "Recurrence payload is invalid for v1.",
            candidate.title,
        )

    def _compute_reminder_offset_minutes(
        self,
        *,
        due_date: date,
        reminder_at: datetime,
        user_timezone: str,
    ) -> int:
        local_timezone = ZoneInfo(user_timezone)
        due_midnight = datetime.combine(due_date, time.min, tzinfo=local_timezone)
        reminder_local = reminder_at.astimezone(local_timezone)
        delta = reminder_local - due_midnight
        return int(delta.total_seconds() // 60)

    def _group_context_payload(self, group: GroupContextRecord) -> dict[str, object]:
        return {
            "id": group.id,
            "name": group.name,
            "description": group.description,
            "recent_task_titles": group.recent_task_titles,
        }

    def _normalize_transcript_text(self, value: str) -> str:
        return value.strip()

    def _map_transcription_error(self, exc: Exception) -> Exception:
        if isinstance(exc, TranscriptionServiceError):
            return TranscriptionFailedError()
        return exc

    def _map_extraction_error(self, exc: Exception) -> Exception:
        if isinstance(exc, ExtractionServiceError):
            return ExtractionFailedError()
        return exc

    def _error_code_for_exception(self, exc: Exception) -> str:
        if isinstance(exc, ValidationError):
            return "payload_invalid"
        if isinstance(exc, TranscriptionServiceError):
            return "transcription_provider_error"
        if isinstance(exc, ExtractorMalformedResponseError):
            return "extractor_payload_invalid"
        if isinstance(exc, ExtractionServiceError):
            return "extraction_provider_error"
        return "unknown_error"
