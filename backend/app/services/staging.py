"""Staging service for managing extracted tasks before approval."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime
from typing import Optional

from app.core.errors import ExtractedTaskNotFoundError, ExtractedTaskStateConflictError
from app.core.settings import Settings
from app.db.engine import connection_scope
from app.db.repositories import (
    ExtractedTaskRecord,
    GroupContextRecord,
    GroupRecord,
    TaskRecord,
    create_extracted_task,
    create_reminder,
    create_subtasks,
    create_task,
    delete_extracted_tasks_by_capture,
    get_extracted_task,
    list_extracted_tasks,
    update_extracted_task_due_date,
    update_extracted_task_status,
)
from app.services.extraction_models import ExtractedTaskCandidate, ExtractorPayload
from app.services.task_rules import RecurrenceInput, normalize_task_fields

logger = logging.getLogger("gust.api")


@dataclass
class StagingResult:
    extracted_tasks: list[ExtractedTaskRecord]


@dataclass
class ApproveResult:
    task: TaskRecord
    extracted_task_id: str


class StagingService:
    def __init__(self, *, settings: Settings) -> None:
        self.settings = settings

    async def store_extracted_tasks(
        self,
        *,
        user_id: str,
        capture_id: str,
        extracted_payload: ExtractorPayload,
        groups: list[GroupContextRecord],
        inbox_group: GroupRecord,
        user_timezone: str,
    ) -> StagingResult:
        """Store extracted tasks in staging table.

        Args:
            user_id: User ID.
            capture_id: Capture ID.
            extracted_payload: Extracted tasks from extraction service.
            groups: User's groups for context.
            inbox_group: User's inbox group.
            user_timezone: User's timezone.

        Returns:
            StagingResult with list of created extracted tasks.
        """
        groups_by_id = {group.id: group for group in groups}
        groups_by_name = {group.name.lower(): group for group in groups}

        extracted_tasks: list[ExtractedTaskRecord] = []

        with connection_scope(self.settings.database_url) as connection:
            for candidate in extracted_payload.tasks:
                try:
                    # Resolve group
                    resolved_group = self._resolve_candidate_group(
                        candidate=candidate,
                        inbox_group=inbox_group,
                        groups_by_id=groups_by_id,
                        groups_by_name=groups_by_name,
                    )

                    # Determine if needs review based on confidence
                    needs_review = candidate.top_confidence < 0.7

                    # Normalize task fields
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
                        )
                    except ValueError:
                        # Skip invalid tasks
                        logger.warning(
                            "staging_task_normalization_failed",
                            extra={
                                "event": "staging_task_normalization_failed",
                                "user_id": user_id,
                                "capture_id": capture_id,
                                "task_title": candidate.title,
                            },
                        )
                        continue

                    # Collect subtask titles from the candidate
                    subtask_titles = [s.title for s in candidate.subtasks if s.title.strip()]

                    # Create extracted task
                    extracted_task = create_extracted_task(
                        connection,
                        user_id=user_id,
                        capture_id=capture_id,
                        title=normalized.title,
                        group_id=resolved_group.id if resolved_group else inbox_group.id,
                        group_name=resolved_group.name if resolved_group else inbox_group.name,
                        due_date=normalized.due_date,
                        reminder_at=normalized.reminder_at,
                        recurrence_frequency=normalized.recurrence_frequency,
                        recurrence_weekday=normalized.recurrence_weekday,
                        recurrence_day_of_month=normalized.recurrence_day_of_month,
                        top_confidence=candidate.top_confidence,
                        needs_review=needs_review,
                        subtask_titles=subtask_titles or None,
                    )
                    extracted_tasks.append(extracted_task)

                except Exception as exc:
                    logger.warning(
                        "staging_task_creation_failed",
                        extra={
                            "event": "staging_task_creation_failed",
                            "user_id": user_id,
                            "capture_id": capture_id,
                            "task_title": candidate.title,
                            "error": str(exc),
                        },
                    )
                    continue

        logger.info(
            "staging_tasks_stored",
            extra={
                "event": "staging_tasks_stored",
                "user_id": user_id,
                "capture_id": capture_id,
                "tasks_stored": len(extracted_tasks),
            },
        )

        return StagingResult(extracted_tasks=extracted_tasks)

    async def approve_task(
        self,
        *,
        user_id: str,
        capture_id: str,
        extracted_task_id: str,
    ) -> ApproveResult:
        """Approve a single extracted task and create final task.

        Args:
            user_id: User ID.
            capture_id: Capture ID.
            extracted_task_id: Extracted task ID.

        Returns:
            ApproveResult with created task and extracted task ID.

        Raises:
            ExtractedTaskNotFoundError: If extracted task cannot be resolved for this user/capture.
            ExtractedTaskStateConflictError: If extracted task has already been processed.
        """
        with connection_scope(self.settings.database_url) as connection:
            extracted_task = get_extracted_task(
                connection, user_id=user_id, extracted_task_id=extracted_task_id
            )
            if extracted_task is None:
                raise ExtractedTaskNotFoundError()
            if extracted_task.capture_id != capture_id:
                raise ExtractedTaskNotFoundError()
            if extracted_task.status != "pending":
                raise ExtractedTaskStateConflictError()

            # Create final task
            task = create_task(
                connection,
                user_id=user_id,
                group_id=extracted_task.group_id,
                capture_id=capture_id,
                title=extracted_task.title,
                needs_review=extracted_task.needs_review,
                due_date=extracted_task.due_date,
                reminder_at=extracted_task.reminder_at,
                recurrence_frequency=extracted_task.recurrence_frequency,
                recurrence_weekday=extracted_task.recurrence_weekday,
                recurrence_day_of_month=extracted_task.recurrence_day_of_month,
            )

            # Create subtasks if any were staged
            if extracted_task.subtask_titles:
                create_subtasks(
                    connection,
                    user_id=user_id,
                    task_id=task.id,
                    titles=extracted_task.subtask_titles,
                )

            # Create reminder if needed
            if extracted_task.reminder_at is not None:
                create_reminder(
                    connection,
                    user_id=user_id,
                    task_id=task.id,
                    scheduled_for=extracted_task.reminder_at,
                )

            # Update extracted task status
            update_extracted_task_status(
                connection,
                user_id=user_id,
                extracted_task_id=extracted_task_id,
                status="approved",
            )

        logger.info(
            "staging_task_approved",
            extra={
                "event": "staging_task_approved",
                "user_id": user_id,
                "capture_id": capture_id,
                "extracted_task_id": extracted_task_id,
                "task_id": task.id,
            },
        )

        return ApproveResult(task=task, extracted_task_id=extracted_task_id)

    async def discard_task(
        self,
        *,
        user_id: str,
        capture_id: str,
        extracted_task_id: str,
    ) -> None:
        """Discard a single extracted task.

        Args:
            user_id: User ID.
            capture_id: Capture ID.
            extracted_task_id: Extracted task ID.

        Raises:
            ExtractedTaskNotFoundError: If extracted task cannot be resolved for this user/capture.
            ExtractedTaskStateConflictError: If extracted task has already been processed.
        """
        with connection_scope(self.settings.database_url) as connection:
            extracted_task = get_extracted_task(
                connection, user_id=user_id, extracted_task_id=extracted_task_id
            )
            if extracted_task is None:
                raise ExtractedTaskNotFoundError()
            if extracted_task.capture_id != capture_id:
                raise ExtractedTaskNotFoundError()
            if extracted_task.status != "pending":
                raise ExtractedTaskStateConflictError()

            update_extracted_task_status(
                connection,
                user_id=user_id,
                extracted_task_id=extracted_task_id,
                status="discarded",
            )

        logger.info(
            "staging_task_discarded",
            extra={
                "event": "staging_task_discarded",
                "user_id": user_id,
                "capture_id": capture_id,
                "extracted_task_id": extracted_task_id,
            },
        )

    async def update_task_due_date(
        self,
        *,
        user_id: str,
        capture_id: str,
        extracted_task_id: str,
        due_date: Optional[date],
    ) -> ExtractedTaskRecord:
        """Update the due date of an extracted task.

        Args:
            user_id: User ID.
            capture_id: Capture ID.
            extracted_task_id: Extracted task ID.
            due_date: Due date or None to clear.

        Returns:
            Updated extracted task record.

        Raises:
            ExtractedTaskNotFoundError: If extracted task cannot be found.
        """
        with connection_scope(self.settings.database_url) as connection:
            extracted_task = get_extracted_task(
                connection, user_id=user_id, extracted_task_id=extracted_task_id
            )
            if extracted_task is None:
                raise ExtractedTaskNotFoundError()
            if extracted_task.capture_id != capture_id:
                raise ExtractedTaskNotFoundError()
            if extracted_task.status != "pending":
                raise ExtractedTaskStateConflictError()

            updated_task = update_extracted_task_due_date(
                connection,
                user_id=user_id,
                extracted_task_id=extracted_task_id,
                due_date=due_date,
            )

        logger.info(
            "staging_task_due_date_updated",
            extra={
                "event": "staging_task_due_date_updated",
                "user_id": user_id,
                "capture_id": capture_id,
                "extracted_task_id": extracted_task_id,
                "due_date": due_date,
            },
        )

        return updated_task

    async def approve_all(
        self,
        *,
        user_id: str,
        capture_id: str,
    ) -> list[ApproveResult]:
        """Approve all pending extracted tasks for a capture.

        Args:
            user_id: User ID.
            capture_id: Capture ID.

        Returns:
            List of ApproveResult with created tasks.
        """
        with connection_scope(self.settings.database_url) as connection:
            pending_tasks = list_extracted_tasks(
                connection, user_id=user_id, capture_id=capture_id, status="pending"
            )

        results: list[ApproveResult] = []
        for extracted_task in pending_tasks:
            try:
                result = await self.approve_task(
                    user_id=user_id,
                    capture_id=capture_id,
                    extracted_task_id=extracted_task.id,
                )
                results.append(result)
            except Exception as exc:
                logger.warning(
                    "staging_approve_all_task_failed",
                    extra={
                        "event": "staging_approve_all_task_failed",
                        "user_id": user_id,
                        "capture_id": capture_id,
                        "extracted_task_id": extracted_task.id,
                        "error": str(exc),
                    },
                )
                continue

        logger.info(
            "staging_approve_all_completed",
            extra={
                "event": "staging_approve_all_completed",
                "user_id": user_id,
                "capture_id": capture_id,
                "tasks_approved": len(results),
                "tasks_failed": len(pending_tasks) - len(results),
            },
        )

        return results

    async def discard_all(
        self,
        *,
        user_id: str,
        capture_id: str,
    ) -> int:
        """Discard all pending extracted tasks for a capture.

        Args:
            user_id: User ID.
            capture_id: Capture ID.

        Returns:
            Number of tasks discarded.
        """
        with connection_scope(self.settings.database_url) as connection:
            pending_tasks = list_extracted_tasks(
                connection, user_id=user_id, capture_id=capture_id, status="pending"
            )

            for extracted_task in pending_tasks:
                update_extracted_task_status(
                    connection,
                    user_id=user_id,
                    extracted_task_id=extracted_task.id,
                    status="discarded",
                )

        logger.info(
            "staging_discard_all_completed",
            extra={
                "event": "staging_discard_all_completed",
                "user_id": user_id,
                "capture_id": capture_id,
                "tasks_discarded": len(pending_tasks),
            },
        )

        return len(pending_tasks)

    async def list_extracted_tasks(
        self,
        *,
        user_id: str,
        capture_id: Optional[str] = None,
        status: Optional[str] = None,
    ) -> list[ExtractedTaskRecord]:
        """List extracted tasks for a user.

        Args:
            user_id: User ID.
            capture_id: Optional capture ID filter.
            status: Optional status filter.

        Returns:
            List of extracted tasks.
        """
        with connection_scope(self.settings.database_url) as connection:
            return list_extracted_tasks(
                connection,
                user_id=user_id,
                capture_id=capture_id,
                status=status,
            )

    async def get_extracted_task(
        self,
        *,
        user_id: str,
        extracted_task_id: str,
    ) -> Optional[ExtractedTaskRecord]:
        """Get a single extracted task by ID.

        Args:
            user_id: User ID.
            extracted_task_id: Extracted task ID.

        Returns:
            Extracted task record or None if not found.
        """
        with connection_scope(self.settings.database_url) as connection:
            return get_extracted_task(
                connection,
                user_id=user_id,
                extracted_task_id=extracted_task_id,
            )

    async def re_extract(
        self,
        *,
        user_id: str,
        capture_id: str,
        transcript_text: str,
        extraction_service,
        groups: list[GroupContextRecord],
        inbox_group: GroupRecord,
        user_timezone: str,
    ) -> StagingResult:
        """Re-extract tasks from edited transcript.

        Args:
            user_id: User ID.
            capture_id: Capture ID.
            transcript_text: Edited transcript text.
            extraction_service: Extraction service instance.
            groups: User's groups for context.
            inbox_group: User's inbox group.
            user_timezone: User's timezone.

        Returns:
            StagingResult with new extracted tasks.
        """
        # Delete existing extracted tasks for this capture
        with connection_scope(self.settings.database_url) as connection:
            delete_extracted_tasks_by_capture(
                connection, user_id=user_id, capture_id=capture_id
            )

        # Run extraction
        from app.services.extraction import ExtractionRequest
        from zoneinfo import ZoneInfo

        extraction_request = ExtractionRequest(
            transcript_text=transcript_text,
            user_timezone=user_timezone,
            current_local_date=datetime.now(ZoneInfo(user_timezone)).date(),
            groups=[self._group_context_payload(group) for group in groups],
        )

        raw_payload = await extraction_service.extract(request=extraction_request)
        extractor_payload = ExtractorPayload.model_validate(raw_payload)

        # Store new extracted tasks
        return await self.store_extracted_tasks(
            user_id=user_id,
            capture_id=capture_id,
            extracted_payload=extractor_payload,
            groups=groups,
            inbox_group=inbox_group,
            user_timezone=user_timezone,
        )

    def _resolve_candidate_group(
        self,
        *,
        candidate: ExtractedTaskCandidate,
        inbox_group: GroupRecord,
        groups_by_id: dict[str, GroupContextRecord],
        groups_by_name: dict[str, GroupContextRecord],
    ) -> Optional[GroupContextRecord]:
        """Resolve the best group for a candidate.

        Args:
            candidate: Extracted task candidate.
            inbox_group: User's inbox group.
            groups_by_id: Groups indexed by ID.
            groups_by_name: Groups indexed by lowercase name.

        Returns:
            Resolved group or None if should use inbox.
        """
        # Try group_id first
        if candidate.group_id and candidate.group_id in groups_by_id:
            return groups_by_id[candidate.group_id]

        # Try group_name
        if candidate.group_name:
            group = groups_by_name.get(candidate.group_name.lower())
            if group is not None:
                return group

        # Check alternative groups
        for alt in candidate.alternative_groups:
            if alt.group_id and alt.group_id in groups_by_id:
                return groups_by_id[alt.group_id]
            if alt.group_name:
                group = groups_by_name.get(alt.group_name.lower())
                if group is not None:
                    return group

        return None

    def _has_tie(self, candidate: ExtractedTaskCandidate) -> bool:
        """Check if there's a tie in group confidence.

        Args:
            candidate: Extracted task candidate.

        Returns:
            True if there's a tie, False otherwise.
        """
        if not candidate.alternative_groups:
            return False

        top_confidence = candidate.top_confidence
        for alt in candidate.alternative_groups:
            if abs(alt.confidence - top_confidence) < 0.01:
                return True

        return False

    def _group_context_payload(self, group: GroupContextRecord) -> dict[str, object]:
        """Convert group context to extraction payload format.

        Args:
            group: Group context record.

        Returns:
            Dictionary for extraction payload.
        """
        return {
            "id": group.id,
            "name": group.name,
            "description": group.description,
            "recent_task_titles": group.recent_task_titles,
        }
