from __future__ import annotations

# ruff: noqa: UP037, UP045
import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Optional, Protocol
from zoneinfo import ZoneInfo

from pydantic import ValidationError

from app.core.errors import (
    CaptureNotFoundError,
    CaptureStateConflictError,
    ConfigurationError,
    ExtractionFailedError,
    InvalidConfigurationError,
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
    delete_extracted_tasks_by_capture,
    create_subtasks,
    create_task,
    ensure_inbox_group,
    get_capture,
    get_user,
    list_extracted_tasks,
    list_groups_with_recent_tasks,
    update_capture,
)
from app.services.extraction import (
    ExtractionRequest,
    ExtractionServiceError,
    ExtractorMalformedResponseError,
)
from app.services.extraction_guardrails import (
    GuardedIntent,
    build_fallback_title,
    detect_guarded_intents,
    find_missing_guarded_intents,
)
from app.services.extraction_models import (
    ExtractionRecurrence,
    ExtractedTaskCandidate,
    ExtractorPayload,
)
from app.services.staging import StagingService
from app.services.task_rules import RecurrenceInput, normalize_task_fields
from app.services.transcription import (
    MistralTranscriptionService,
    MockTranscriptionService,
    TranscriptionServiceError,
)

logger = logging.getLogger("gust.api")


class TranscriptionClient(Protocol):
    async def transcribe(
        self,
        *,
        audio_bytes: bytes,
        filename: str,
        content_type: str,
    ) -> TranscriptionResult: ...


class ExtractionClient(Protocol):
    async def extract(
        self,
        *,
        request: ExtractionRequest,
    ) -> dict[str, object]: ...


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
    series_id: Optional[str]
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
        transcription_service: MistralTranscriptionService | MockTranscriptionService,
        extraction_service: ExtractionClient,
        staging_service: StagingService,
    ) -> None:
        self.settings = settings
        self.transcription_service = transcription_service
        self.extraction_service = extraction_service
        self.staging_service = staging_service
        self.last_extraction_attempt_count = 0

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

        # Automatically extract and store in staging
        try:
            await self._extract_and_store_in_staging(
                user_id=user_id,
                capture_id=updated.id,
                transcript_text=updated.transcript_text or "",
            )
        except Exception as exc:
            logger.warning(
                "auto_extraction_failed",
                extra={
                    "event": "auto_extraction_failed",
                    "capture_id": updated.id,
                    "user_id": user_id,
                    "error": str(exc),
                },
            )
            # Don't fail the capture creation, just log the error

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

        # Automatically extract and store in staging
        try:
            await self._extract_and_store_in_staging(
                user_id=user_id,
                capture_id=capture.id,
                transcript_text=normalized,
            )
        except Exception as exc:
            logger.warning(
                "auto_extraction_failed",
                extra={
                    "event": "auto_extraction_failed",
                    "capture_id": capture.id,
                    "user_id": user_id,
                    "error": str(exc),
                },
            )
            # Don't fail the capture creation, just log the error

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

        try:
            extractor_payload, extraction_attempt_count = await self._extract_payload_with_guardrails(
                transcript_text=normalized_transcript,
                extraction_request=extraction_request,
                inbox_group=inbox_group,
            )
        except (ExtractorMalformedResponseError, ValidationError) as exc:
            extraction_attempt_count = self._resolve_extraction_attempt_count()
            self._mark_capture_failure(
                capture_id=capture_id,
                user_id=user_id,
                status="extraction_failed",
                error_code="extractor_payload_invalid",
                extraction_attempt_count=extraction_attempt_count,
                transcript_edited_text=normalized_transcript,
            )
            raise ExtractionFailedError() from exc
        except ExtractionServiceError as exc:
            extraction_attempt_count = self._resolve_extraction_attempt_count()
            self._mark_capture_failure(
                capture_id=capture_id,
                user_id=user_id,
                status="extraction_failed",
                error_code="extraction_provider_error",
                extraction_attempt_count=extraction_attempt_count,
                transcript_edited_text=normalized_transcript,
            )
            raise ExtractionFailedError() from exc
        except Exception as exc:
            extraction_attempt_count = self._resolve_extraction_attempt_count()
            self._mark_capture_failure(
                capture_id=capture_id,
                user_id=user_id,
                status="extraction_failed",
                error_code=self._error_code_for_exception(exc),
                extraction_attempt_count=extraction_attempt_count,
                transcript_edited_text=normalized_transcript,
            )
            raise self._map_extraction_error(exc) from exc

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
                    series_id=prepared.series_id,
                )
                if prepared.subtasks:
                    create_subtasks(
                        connection,
                        user_id=user_id,
                        task_id=task.id,
                        titles=prepared.subtasks,
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
                extraction_attempt_count=extraction_attempt_count,
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

        recurrence_input = None
        if candidate.recurrence is not None:
            recurrence_input = RecurrenceInput(
                frequency=candidate.recurrence.frequency,
                weekday=candidate.recurrence.weekday,
                day_of_month=candidate.recurrence.day_of_month,
            )

        try:
            normalized = normalize_task_fields(
                title=candidate.title,
                due_date=candidate.due_date,
                reminder_at=candidate.reminder_at,
                recurrence=recurrence_input,
                user_timezone=user_timezone,
                # Lenient: accept AI-extracted tasks with imperfect datetime/recurrence
                assume_utc_for_naive=True,
                default_due_date_for_recurrence=True,
            )
        except ValueError as exc:
            message = str(exc)
            if message == "Task title cannot be blank.":
                raise CandidateValidationError("invalid_title", message, candidate.title) from exc
            if message == "Reminder timestamp must include a timezone.":
                raise CandidateValidationError(
                    "invalid_reminder",
                    message,
                    candidate.title,
                ) from exc
            if message == "Reminder requires a due date.":
                raise CandidateValidationError(
                    "reminder_requires_due_date", message, candidate.title
                ) from exc
            if message in {
                "Recurrence payload is invalid for v1.",
                "Recurrence requires a due date.",
            }:
                raise CandidateValidationError(
                    "invalid_recurrence",
                    message,
                    candidate.title,
                ) from exc
            raise

        subtasks = [subtask.title for subtask in candidate.subtasks]
        return PreparedTask(
            title=normalized.title,
            group_id=group_id,
            needs_review=needs_review,
            due_date=normalized.due_date,
            reminder_at=normalized.reminder_at,
            reminder_offset_minutes=normalized.reminder_offset_minutes,
            series_id=normalized.series_id,
            recurrence_frequency=normalized.recurrence_frequency,
            recurrence_interval=normalized.recurrence_interval,
            recurrence_weekday=normalized.recurrence_weekday,
            recurrence_day_of_month=normalized.recurrence_day_of_month,
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

    def _group_context_payload(self, group: GroupContextRecord) -> dict[str, object]:
        return {
            "id": group.id,
            "name": group.name,
            "description": group.description,
            "recent_task_titles": group.recent_task_titles,
        }

    def _normalize_transcript_text(self, value: str) -> str:
        return value.strip()

    def _resolve_extraction_attempt_count(self) -> int:
        if self.last_extraction_attempt_count > 0:
            return self.last_extraction_attempt_count
        return self._resolve_service_attempt_count()

    def _resolve_service_attempt_count(self) -> int:
        attempts = getattr(self.extraction_service, "last_attempt_count", None)
        if isinstance(attempts, int) and attempts > 0:
            return attempts
        return 1

    def _reset_extraction_attempt_count(self) -> None:
        self.last_extraction_attempt_count = 0

    def _record_extraction_attempt_count(self, attempts: int) -> int:
        self.last_extraction_attempt_count = attempts
        return attempts

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
        if isinstance(exc, InvalidConfigurationError):
            return "config_invalid"
        if isinstance(exc, ConfigurationError):
            return "config_missing"
        if isinstance(exc, TranscriptionServiceError):
            return "transcription_provider_error"
        if isinstance(exc, ExtractorMalformedResponseError):
            return "extractor_payload_invalid"
        if isinstance(exc, ExtractionServiceError):
            return "extraction_provider_error"
        return "unknown_error"

    async def _extract_payload_with_guardrails(
        self,
        *,
        transcript_text: str,
        extraction_request: ExtractionRequest,
        inbox_group: GroupRecord,
    ) -> tuple[ExtractorPayload, int]:
        self._reset_extraction_attempt_count()
        guarded_intents = detect_guarded_intents(transcript_text)
        total_attempt_count = 0

        payload, attempt_count = await self._extract_validated_payload(extraction_request)
        total_attempt_count += attempt_count

        missing_guarded_intents = find_missing_guarded_intents(
            guarded_intents=guarded_intents,
            extracted_tasks=payload.tasks,
        )
        if not missing_guarded_intents:
            return payload, self._record_extraction_attempt_count(total_attempt_count)

        repair_request = ExtractionRequest(
            transcript_text=extraction_request.transcript_text,
            user_timezone=extraction_request.user_timezone,
            current_local_date=extraction_request.current_local_date,
            groups=extraction_request.groups,
            missing_guarded_clauses=[intent.raw_text for intent in missing_guarded_intents],
        )
        repaired_payload, repair_attempt_count = await self._extract_validated_payload(repair_request)
        total_attempt_count += repair_attempt_count

        missing_after_repair = find_missing_guarded_intents(
            guarded_intents=guarded_intents,
            extracted_tasks=repaired_payload.tasks,
        )
        if not missing_after_repair:
            logger.info(
                "extraction_guardrail_repair_succeeded",
                extra={
                    "event": "extraction_guardrail_repair_succeeded",
                    "missing_count": len(missing_guarded_intents),
                },
            )
            return repaired_payload, self._record_extraction_attempt_count(total_attempt_count)

        fallback_payload = self._append_guarded_fallbacks(
            payload=repaired_payload,
            missing_guarded_intents=missing_after_repair,
            inbox_group=inbox_group,
        )
        logger.warning(
            "extraction_guardrail_fallback_created",
            extra={
                "event": "extraction_guardrail_fallback_created",
                "missing_count": len(missing_after_repair),
            },
        )
        return fallback_payload, self._record_extraction_attempt_count(total_attempt_count)

    async def _extract_validated_payload(
        self,
        request: ExtractionRequest,
    ) -> tuple[ExtractorPayload, int]:
        total_attempt_count = 0
        last_exception: Exception | None = None

        for outer_attempt in range(2):
            current_attempt_count = 0
            try:
                raw_payload = await self.extraction_service.extract(request=request)
                current_attempt_count = self._resolve_service_attempt_count()
                validated_payload = ExtractorPayload.model_validate(raw_payload)
                total_attempt_count += current_attempt_count
                return validated_payload, total_attempt_count
            except (ExtractorMalformedResponseError, ValidationError) as exc:
                total_attempt_count += current_attempt_count or self._resolve_service_attempt_count()
                last_exception = exc
                self._record_extraction_attempt_count(total_attempt_count)
                if outer_attempt == 0:
                    continue
                raise
            except Exception:
                total_attempt_count += current_attempt_count or self._resolve_service_attempt_count()
                self._record_extraction_attempt_count(total_attempt_count)
                raise

        assert last_exception is not None
        raise last_exception

    def _append_guarded_fallbacks(
        self,
        *,
        payload: ExtractorPayload,
        missing_guarded_intents: list[GuardedIntent],
        inbox_group: GroupRecord,
    ) -> ExtractorPayload:
        existing_titles = {task.title.strip().lower() for task in payload.tasks}
        fallback_tasks = list(payload.tasks)

        for intent in missing_guarded_intents:
            fallback_title = build_fallback_title(intent)
            if fallback_title.strip().lower() in existing_titles:
                continue
            fallback_tasks.append(
                ExtractedTaskCandidate(
                    title=fallback_title,
                    group_id=inbox_group.id,
                    top_confidence=0.0,
                )
            )
            existing_titles.add(fallback_title.strip().lower())

        return ExtractorPayload(tasks=fallback_tasks)

    async def _extract_and_store_in_staging(
        self,
        *,
        user_id: str,
        capture_id: str,
        transcript_text: str,
    ) -> None:
        """Extract tasks from transcript and store in staging table.

        Args:
            user_id: User ID.
            capture_id: Capture ID.
            transcript_text: Transcript text to extract from.
        """
        normalized_transcript = self._normalize_transcript_text(transcript_text)
        if not normalized_transcript:
            return

        with connection_scope(self.settings.database_url) as connection:
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

        try:
            extractor_payload, _attempt_count = await self._extract_payload_with_guardrails(
                transcript_text=normalized_transcript,
                extraction_request=extraction_request,
                inbox_group=inbox_group,
            )
        except (ExtractorMalformedResponseError, ValidationError) as exc:
            logger.warning(
                "extraction_failed_for_staging",
                extra={
                    "event": "extraction_failed_for_staging",
                    "capture_id": capture_id,
                    "user_id": user_id,
                    "error": str(exc),
                },
            )
            return
        except ExtractionServiceError as exc:
            logger.warning(
                "extraction_failed_for_staging",
                extra={
                    "event": "extraction_failed_for_staging",
                    "capture_id": capture_id,
                    "user_id": user_id,
                    "error": str(exc),
                },
            )
            return

        # Store extracted tasks in staging
        await self.staging_service.store_extracted_tasks(
            user_id=user_id,
            capture_id=capture_id,
            extracted_payload=extractor_payload,
            groups=groups,
            inbox_group=inbox_group,
            user_timezone=user.timezone,
        )

        logger.info(
            "auto_extraction_completed",
            extra={
                "event": "auto_extraction_completed",
                "capture_id": capture_id,
                "user_id": user_id,
                "tasks_extracted": len(extractor_payload.tasks),
            },
        )

    async def re_extract_capture(
        self,
        *,
        user_id: str,
        capture_id: str,
        transcript_text: str,
    ) -> ReviewCaptureResult:
        """Re-extract tasks from an edited transcript.

        Args:
            user_id: User ID.
            capture_id: Capture ID.
            transcript_text: Edited transcript text.

        Returns:
            ReviewCaptureResult with updated capture.

        Raises:
            CaptureNotFoundError: If capture not found.
            CaptureStateConflictError: If capture is not in a valid state.
            InvalidCaptureError: If transcript is empty.
        """
        normalized_transcript = self._normalize_transcript_text(transcript_text)
        if not normalized_transcript:
            raise InvalidCaptureError("Transcript cannot be empty.")

        with connection_scope(self.settings.database_url) as connection:
            capture = get_capture(connection, user_id=user_id, capture_id=capture_id)
            if capture is None:
                raise CaptureNotFoundError()
            if capture.status not in {"ready_for_review", "extraction_failed"}:
                raise CaptureStateConflictError()

            # Re-extraction should replace prior staged output for this capture.
            delete_extracted_tasks_by_capture(
                connection,
                user_id=user_id,
                capture_id=capture_id,
            )

            # Update the capture with the edited transcript
            updated = update_capture(
                connection,
                user_id=user_id,
                capture_id=capture_id,
                transcript_text=normalized_transcript,
                transcript_edited_text=normalized_transcript,
                status="ready_for_review",
                error_code=None,
            )

        assert updated is not None

        # Re-extract and store in staging
        await self._extract_and_store_in_staging(
            user_id=user_id,
            capture_id=capture_id,
            transcript_text=normalized_transcript,
        )

        logger.info(
            "capture_re_extracted",
            extra={
                "event": "capture_re_extracted",
                "capture_id": capture_id,
                "user_id": user_id,
            },
        )

        return ReviewCaptureResult(
            capture_id=updated.id,
            status=updated.status,
            transcript_text=updated.transcript_text or "",
        )

    async def complete_capture(
        self,
        *,
        user_id: str,
        capture_id: str,
    ) -> None:
        """Mark a capture as completed after staging tasks are resolved.

        Args:
            user_id: User ID.
            capture_id: Capture ID.

        Raises:
            CaptureNotFoundError: If capture not found.
            CaptureStateConflictError: If capture is not in a valid state for completion.
        """
        with connection_scope(self.settings.database_url) as connection:
            capture = get_capture(connection, user_id=user_id, capture_id=capture_id)
            if capture is None:
                raise CaptureNotFoundError()
            if capture.status not in {"ready_for_review", "extraction_failed"}:
                raise CaptureStateConflictError()
            pending_tasks = list_extracted_tasks(
                connection,
                user_id=user_id,
                capture_id=capture_id,
                status="pending",
            )
            if pending_tasks:
                raise CaptureStateConflictError(
                    "Capture still has pending extracted tasks to review."
                )

            # Transition capture to completed status
            update_capture(
                connection,
                user_id=user_id,
                capture_id=capture_id,
                status="completed",
            )

        logger.info(
            "capture_completed",
            extra={
                "event": "capture_completed",
                "capture_id": capture_id,
                "user_id": user_id,
            },
        )
