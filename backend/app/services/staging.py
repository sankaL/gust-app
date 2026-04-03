"""Staging service for managing extracted tasks before approval."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime

from app.core.errors import (
    ExtractedTaskNotFoundError,
    ExtractedTaskStateConflictError,
    GroupNotFoundError,
    InvalidTaskError,
)
from app.core.input_safety import MAX_TITLE_CHARS, sanitize_for_log, validate_plain_text
from app.core.settings import Settings
from app.core.timing import timed_stage
from app.db.engine import user_connection_scope
from app.db.repositories import (
    ExtractedTaskRecord,
    GroupContextRecord,
    GroupRecord,
    TaskRecord,
    create_extracted_task,
    create_subtasks,
    create_task,
    delete_extracted_tasks_by_capture,
    get_extracted_task,
    get_group,
    list_extracted_tasks,
    update_extracted_task,
    update_extracted_task_due_date,
    update_extracted_task_status,
)
from app.services.extraction_models import ExtractedTaskCandidate, ExtractorPayload
from app.services.task_rules import (
    RecurrenceInput,
    normalize_task_description,
    normalize_task_fields,
)

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

        with user_connection_scope(self.settings.database_url, user_id=user_id) as connection:
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
                            month=candidate.recurrence.month,
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
                    except ValueError:
                        # Skip invalid tasks
                        logger.warning(
                            "staging_task_normalization_failed",
                            extra={
                                "event": "staging_task_normalization_failed",
                                "user_id": user_id,
                                "capture_id": capture_id,
                                "task_title": sanitize_for_log(candidate.title),
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
                        description=normalize_task_description(
                            candidate.description, title=normalized.title
                        ),
                        group_id=resolved_group.id if resolved_group else inbox_group.id,
                        group_name=resolved_group.name if resolved_group else inbox_group.name,
                        due_date=normalized.due_date,
                        reminder_at=normalized.reminder_at,
                        recurrence_frequency=normalized.recurrence_frequency,
                        recurrence_weekday=normalized.recurrence_weekday,
                        recurrence_day_of_month=normalized.recurrence_day_of_month,
                        recurrence_month=normalized.recurrence_month,
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
                            "task_title": sanitize_for_log(candidate.title),
                            "error_type": type(exc).__name__,
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
        with timed_stage("db.staging.approve"):
            with user_connection_scope(self.settings.database_url, user_id=user_id) as connection:
                extracted_task = get_extracted_task(
                    connection, user_id=user_id, extracted_task_id=extracted_task_id
                )
                if extracted_task is None:
                    raise ExtractedTaskNotFoundError()
                if extracted_task.capture_id != capture_id:
                    raise ExtractedTaskNotFoundError()
                if extracted_task.status != "pending":
                    raise ExtractedTaskStateConflictError()

                task = self._approve_pending_task_in_connection(
                    connection,
                    user_id=user_id,
                    capture_id=capture_id,
                    extracted_task=extracted_task,
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
        with timed_stage("db.staging.discard"):
            with user_connection_scope(self.settings.database_url, user_id=user_id) as connection:
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
        due_date: date | None,
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
        with user_connection_scope(self.settings.database_url, user_id=user_id) as connection:
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

    async def update_extracted_task(
        self,
        *,
        user_id: str,
        user_timezone: str,
        capture_id: str,
        extracted_task_id: str,
        updates: dict[str, object],
    ) -> ExtractedTaskRecord:
        """Update an extracted task with a partial set of fields.

        Args:
            user_id: User ID.
            user_timezone: User timezone (used for validation rules).
            capture_id: Capture ID.
            extracted_task_id: Extracted task ID.
            updates: A dict of fields to update. Keys not present are left unchanged. Values may be
                explicitly set to None to clear nullable fields.

        Returns:
            Updated extracted task record.

        Raises:
            ExtractedTaskNotFoundError: If extracted task cannot be found.
        """
        allowed_update_fields: set[str] = {
            "title",
            "description",
            "group_id",
            "due_date",
            "reminder_at",
            "recurrence_frequency",
            "recurrence_weekday",
            "recurrence_day_of_month",
            "recurrence_month",
        }
        unknown_fields = set(updates.keys()) - allowed_update_fields
        if unknown_fields:
            raise InvalidTaskError("Extracted task update contains unsupported fields.")

        with user_connection_scope(self.settings.database_url, user_id=user_id) as connection:
            extracted_task = get_extracted_task(
                connection, user_id=user_id, extracted_task_id=extracted_task_id
            )
            if extracted_task is None:
                raise ExtractedTaskNotFoundError()
            if extracted_task.capture_id != capture_id:
                raise ExtractedTaskNotFoundError()
            if extracted_task.status != "pending":
                raise ExtractedTaskStateConflictError()

            values: dict[str, object] = dict(updates)

            if "title" in values:
                title = values["title"]
                if not isinstance(title, str):
                    raise InvalidTaskError("Title must be a string.")
                try:
                    values["title"] = validate_plain_text(
                        title,
                        field_name="Title",
                        max_length=MAX_TITLE_CHARS,
                    )
                except ValueError as exc:
                    raise InvalidTaskError(str(exc)) from exc

            if "description" in values:
                values["description"] = normalize_task_description(
                    values["description"], title=str(values.get("title", extracted_task.title))
                )

            if "group_id" in values:
                group_id = values["group_id"]
                if not isinstance(group_id, str) or not group_id.strip():
                    raise InvalidTaskError("group_id is required.")
                group = get_group(connection, user_id=user_id, group_id=group_id)
                if group is None:
                    raise GroupNotFoundError("Destination group could not be found.")
                values["group_name"] = group.name

            # If due_date is explicitly cleared, also clear reminders unless the caller
            # explicitly provided reminder_at.
            if values.get("due_date", object()) is None and "reminder_at" not in values:
                values["reminder_at"] = None

            resulting_due_date: date | None = (
                values["due_date"] if "due_date" in values else extracted_task.due_date
            )
            resulting_reminder_at: datetime | None = (
                values["reminder_at"] if "reminder_at" in values else extracted_task.reminder_at
            )
            if resulting_due_date is None and resulting_reminder_at is not None:
                # Fail closed: reminders must not exist without a due date.
                raise InvalidTaskError("A reminder requires a due date.")
            if "reminder_at" in values and values["reminder_at"] is not None:
                reminder_at = values["reminder_at"]
                if not isinstance(reminder_at, datetime) or reminder_at.tzinfo is None:
                    raise InvalidTaskError("reminder_at must be an ISO datetime with timezone.")

            recurrence_fields = {
                "recurrence_frequency",
                "recurrence_weekday",
                "recurrence_day_of_month",
                "recurrence_month",
            }
            if recurrence_fields & values.keys():
                allowed_frequencies = {"daily", "weekly", "monthly", "yearly"}
                existing_frequency = (
                    extracted_task.recurrence_frequency
                    if extracted_task.recurrence_frequency in allowed_frequencies
                    else None
                )
                next_frequency = (
                    values["recurrence_frequency"]
                    if "recurrence_frequency" in values
                    else existing_frequency
                )
                next_weekday = (
                    values["recurrence_weekday"]
                    if "recurrence_weekday" in values
                    else extracted_task.recurrence_weekday
                )
                next_day_of_month = (
                    values["recurrence_day_of_month"]
                    if "recurrence_day_of_month" in values
                    else extracted_task.recurrence_day_of_month
                )
                next_month = (
                    values["recurrence_month"]
                    if "recurrence_month" in values
                    else extracted_task.recurrence_month
                )

                if next_frequency is None:
                    next_weekday = None
                    next_day_of_month = None
                    next_month = None
                elif next_frequency == "daily":
                    next_weekday = None
                    next_day_of_month = None
                    next_month = None
                elif next_frequency == "weekly":
                    if next_weekday is None or not isinstance(next_weekday, int):
                        raise InvalidTaskError("Weekly recurrence requires a weekday (0-6).")
                    if next_weekday < 0 or next_weekday > 6:
                        raise InvalidTaskError("Weekly recurrence weekday must be between 0 and 6.")
                    next_day_of_month = None
                    next_month = None
                elif next_frequency == "monthly":
                    if next_day_of_month is None or not isinstance(next_day_of_month, int):
                        raise InvalidTaskError("Monthly recurrence requires a day of month (1-31).")
                    if next_day_of_month < 1 or next_day_of_month > 31:
                        raise InvalidTaskError("Monthly recurrence day must be between 1 and 31.")
                    next_weekday = None
                    next_month = None
                elif next_frequency == "yearly":
                    if next_month is None or not isinstance(next_month, int):
                        raise InvalidTaskError("Yearly recurrence requires a month (1-12).")
                    if next_month < 1 or next_month > 12:
                        raise InvalidTaskError("Yearly recurrence month must be between 1 and 12.")
                    if next_day_of_month is None or not isinstance(next_day_of_month, int):
                        raise InvalidTaskError("Yearly recurrence requires a day of month (1-31).")
                    if next_day_of_month < 1 or next_day_of_month > 31:
                        raise InvalidTaskError("Yearly recurrence day must be between 1 and 31.")
                    next_weekday = None
                else:
                    raise InvalidTaskError(
                        "recurrence_frequency must be one of daily, weekly, monthly, yearly, "
                        "or null."
                    )

                values["recurrence_frequency"] = next_frequency
                values["recurrence_weekday"] = next_weekday
                values["recurrence_day_of_month"] = next_day_of_month
                values["recurrence_month"] = next_month

            updated_task = update_extracted_task(
                connection,
                user_id=user_id,
                extracted_task_id=extracted_task_id,
                values=values,
            )
            assert updated_task is not None

        logger.info(
            "staging_task_updated",
            extra={
                "event": "staging_task_updated",
                "user_id": user_id,
                "capture_id": capture_id,
                "extracted_task_id": extracted_task_id,
                "updated_fields": sorted(values.keys()),
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
        with timed_stage("db.staging.approve_all"):
            with user_connection_scope(self.settings.database_url, user_id=user_id) as connection:
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
                            "error_type": type(exc).__name__,
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
        with timed_stage("db.staging.discard_all"):
            with user_connection_scope(self.settings.database_url, user_id=user_id) as connection:
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
        capture_id: str | None = None,
        status: str | None = None,
    ) -> list[ExtractedTaskRecord]:
        """List extracted tasks for a user.

        Args:
            user_id: User ID.
            capture_id: Optional capture ID filter.
            status: Optional status filter.

        Returns:
            List of extracted tasks.
        """
        with timed_stage("db.staging.list"):
            with user_connection_scope(self.settings.database_url, user_id=user_id) as connection:
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
    ) -> ExtractedTaskRecord | None:
        """Get a single extracted task by ID.

        Args:
            user_id: User ID.
            extracted_task_id: Extracted task ID.

        Returns:
            Extracted task record or None if not found.
        """
        with user_connection_scope(self.settings.database_url, user_id=user_id) as connection:
            return get_extracted_task(
                connection,
                user_id=user_id,
                extracted_task_id=extracted_task_id,
            )

    def _approve_pending_task_in_connection(
        self,
        connection,
        *,
        user_id: str,
        capture_id: str,
        extracted_task: ExtractedTaskRecord,
    ) -> TaskRecord:
        if extracted_task.capture_id != capture_id:
            raise ExtractedTaskNotFoundError()
        if extracted_task.status != "pending":
            raise ExtractedTaskStateConflictError()

        task = create_task(
            connection,
            user_id=user_id,
            group_id=extracted_task.group_id,
            capture_id=capture_id,
            title=extracted_task.title,
            needs_review=extracted_task.needs_review,
            description=extracted_task.description,
            due_date=extracted_task.due_date,
            reminder_at=extracted_task.reminder_at,
            recurrence_frequency=extracted_task.recurrence_frequency,
            recurrence_weekday=extracted_task.recurrence_weekday,
            recurrence_day_of_month=extracted_task.recurrence_day_of_month,
            recurrence_month=extracted_task.recurrence_month,
        )

        if extracted_task.subtask_titles:
            create_subtasks(
                connection,
                user_id=user_id,
                task_id=task.id,
                titles=extracted_task.subtask_titles,
            )

        update_extracted_task_status(
            connection,
            user_id=user_id,
            extracted_task_id=extracted_task.id,
            status="approved",
        )

        return task

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
        with user_connection_scope(self.settings.database_url, user_id=user_id) as connection:
            delete_extracted_tasks_by_capture(connection, user_id=user_id, capture_id=capture_id)

        # Run extraction
        from zoneinfo import ZoneInfo

        from app.services.extraction import ExtractionRequest

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
    ) -> GroupContextRecord | None:
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
