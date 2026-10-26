"""Task extraction with Claude structured outputs."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime
from time import perf_counter
from typing import Literal

import anthropic
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.core.errors import ConfigurationError
from app.core.settings import Settings
from app.prompts.extraction_prompts import ExtractionPromptManager
from app.services.extraction_models import ExtractorPayload

logger = logging.getLogger("gust.api")

# Phrases the API uses when the organization has no usable credit.
_QUOTA_ERROR_MARKERS = ("credit balance", "billing", "insufficient funds")


@dataclass
class ExtractionRequest:
    """Request for task extraction."""

    transcript_text: str
    user_timezone: str
    current_local_date: date
    groups: list[dict[str, object]]
    missing_guarded_clauses: list[str] | None = None


class ExtractionServiceError(Exception):
    """Base exception for extraction service errors."""


class ExtractorMalformedResponseError(ExtractionServiceError):
    """Raised when the extraction provider returns output that does not match the schema."""


class ExtractionRefusedError(ExtractionServiceError):
    """Raised when the model declines the request; retrying the same input will not help."""


ExtractionAccountFailureReason = Literal["quota_exceeded", "credentials_invalid"]


class ExtractionProviderAccountError(ExtractionServiceError):
    """Raised when the provider account itself is unusable (no credits or rejected key)."""

    def __init__(
        self,
        message: str,
        *,
        failure_reason: ExtractionAccountFailureReason,
        provider_status_code: int | None,
    ) -> None:
        super().__init__(message)
        self.failure_reason = failure_reason
        self.provider_status_code = provider_status_code


# Wire schema: the compact shape the model writes. Optional fields may be omitted, which keeps
# output short. It is translated into ExtractorPayload before anything downstream sees it.
class _WireAlternative(BaseModel):
    model_config = ConfigDict(extra="forbid")

    group: str
    confidence: float


class _WireRecurrence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    frequency: Literal["daily", "weekly", "monthly", "yearly"]
    weekday: int | None = None
    day_of_month: int | None = None
    month: int | None = None


class _WireTask(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    description: str | None = None
    due_date: date | None = None
    reminder_at: datetime | None = None
    reminder_date: date | None = None
    group: str | None = None
    confidence: float = 0.9
    alternatives: list[_WireAlternative] = Field(default_factory=list)
    recurrence: _WireRecurrence | None = None
    subtasks: list[str] = Field(default_factory=list)


class _WirePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tasks: list[_WireTask]


_OUTPUT_SCHEMA = anthropic.transform_schema(_WirePayload.model_json_schema())


def build_extraction_client(settings: Settings) -> anthropic.AsyncAnthropic | None:
    """Long-lived client so each capture reuses an open connection; None when unconfigured."""
    if not settings.anthropic_api_key:
        return None
    return anthropic.AsyncAnthropic(
        api_key=settings.anthropic_api_key,
        base_url=settings.anthropic_base_url,
        timeout=settings.extraction_timeout_seconds,
        # One fast transport-level retry for 429/5xx/connection errors; payload retries live in
        # CaptureService so the total stays bounded.
        max_retries=1,
    )


class ClaudeExtractionService:
    """Extracts task candidates from a transcript with one structured-output call."""

    def __init__(
        self,
        settings: Settings,
        *,
        client: anthropic.AsyncAnthropic | None = None,
        prompt_manager: ExtractionPromptManager | None = None,
    ) -> None:
        self.settings = settings
        self._client = client
        self.prompt_manager = prompt_manager or ExtractionPromptManager()
        self.last_attempt_count = 0

    def ensure_configured(self) -> None:
        if not self.settings.anthropic_api_key:
            raise ConfigurationError(
                "Task extraction is not configured. Please contact the administrator."
            )

    async def extract(self, *, request: ExtractionRequest) -> dict[str, object]:
        """Run one extraction attempt and return a validated ExtractorPayload as a dict."""
        self.last_attempt_count = 0
        self.ensure_configured()
        client = self._client or build_extraction_client(self.settings)
        assert client is not None
        try:
            return await self._extract(client, request)
        finally:
            if self._client is None:
                await client.close()

    async def _extract(
        self,
        client: anthropic.AsyncAnthropic,
        request: ExtractionRequest,
    ) -> dict[str, object]:
        user_prompt = self.prompt_manager.get_user_prompt(
            user_timezone=request.user_timezone,
            current_local_date=request.current_local_date,
            groups=request.groups,
            transcript_text=request.transcript_text,
            missing_guarded_clauses=request.missing_guarded_clauses,
        )
        started_at = perf_counter()
        self.last_attempt_count = 1
        try:
            response = await client.messages.create(
                model=self.settings.extraction_model,
                max_tokens=self.settings.extraction_max_output_tokens,
                system=[
                    {
                        "type": "text",
                        "text": self.prompt_manager.get_system_prompt(),
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                messages=[{"role": "user", "content": user_prompt}],
                thinking={"type": "disabled"},
                output_config={
                    "effort": "low",
                    "format": {"type": "json_schema", "schema": _OUTPUT_SCHEMA},
                },
            )
        except anthropic.APIStatusError as exc:
            self._log_provider_error(exc)
            account_error = _provider_account_error(exc)
            if account_error is not None:
                raise account_error from exc
            raise ExtractionServiceError("Extraction provider request failed.") from exc
        except anthropic.APIConnectionError as exc:
            # APITimeoutError is a subclass, so timeouts land here too.
            logger.warning(
                "extraction_provider_unavailable",
                extra={
                    "event": "extraction_provider_unavailable",
                    "model": self.settings.extraction_model,
                    "error_type": type(exc).__name__,
                },
            )
            raise ExtractionServiceError("Extraction provider is unavailable.") from exc

        latency_ms = int((perf_counter() - started_at) * 1000)
        usage = response.usage
        logger.info(
            "extraction_completed",
            extra={
                "event": "extraction_completed",
                "model": self.settings.extraction_model,
                "stop_reason": response.stop_reason,
                "latency_ms": latency_ms,
                "input_tokens": usage.input_tokens,
                "output_tokens": usage.output_tokens,
                "cache_read_input_tokens": usage.cache_read_input_tokens,
                "cache_creation_input_tokens": usage.cache_creation_input_tokens,
                "transcript_length": len(request.transcript_text),
                "repair": bool(request.missing_guarded_clauses),
            },
        )

        if response.stop_reason == "refusal":
            raise ExtractionRefusedError("Extraction provider declined the request.")
        if response.stop_reason == "max_tokens":
            raise ExtractorMalformedResponseError("Extraction output was truncated.")

        text = next((block.text for block in response.content if block.type == "text"), None)
        if text is None:
            raise ExtractorMalformedResponseError("Extraction provider returned no output.")
        try:
            wire = _WirePayload.model_validate_json(text)
        except ValidationError as exc:
            raise ExtractorMalformedResponseError(
                "Extraction provider returned output that does not match the schema."
            ) from exc
        return _to_extractor_payload(wire, request.groups).model_dump()

    def _log_provider_error(self, exc: anthropic.APIStatusError) -> None:
        logger.warning(
            "extraction_provider_error",
            extra={
                "event": "extraction_provider_error",
                "model": self.settings.extraction_model,
                "error_type": type(exc).__name__,
                "provider_status_code": exc.status_code,
                "request_id": exc.request_id,
            },
        )


def _provider_account_error(exc: anthropic.APIStatusError) -> ExtractionProviderAccountError | None:
    """Classify provider failures that no retry can recover from."""
    status_code = exc.status_code
    message = str(exc.message).lower()
    if status_code == 402 or (
        status_code == 400 and any(marker in message for marker in _QUOTA_ERROR_MARKERS)
    ):
        return ExtractionProviderAccountError(
            "Extraction provider account has insufficient credits.",
            failure_reason="quota_exceeded",
            provider_status_code=status_code,
        )
    if status_code in {401, 403}:
        return ExtractionProviderAccountError(
            "Extraction provider rejected the configured credentials.",
            failure_reason="credentials_invalid",
            provider_status_code=status_code,
        )
    return None


def _to_extractor_payload(wire: _WirePayload, groups: list[dict[str, object]]) -> ExtractorPayload:
    """Map group names back to ids and reshape into the internal candidate contract."""
    groups_by_name = {str(group["name"]).strip().lower(): group for group in groups}

    def group_ref(name: str | None) -> dict[str, object]:
        if not name:
            return {"group_id": None, "group_name": None}
        group = groups_by_name.get(name.strip().lower())
        if group is None:
            # Unknown names stay unresolved so staging routes the task to Inbox for review.
            return {"group_id": None, "group_name": name}
        return {"group_id": str(group["id"]), "group_name": str(group["name"])}

    tasks = [
        {
            "title": task.title,
            "description": task.description,
            "due_date": task.due_date,
            "reminder_at": task.reminder_at,
            "reminder_date": task.reminder_date,
            **group_ref(task.group),
            "top_confidence": min(max(task.confidence, 0.0), 1.0),
            "alternative_groups": [
                {
                    **group_ref(alternative.group),
                    "confidence": min(max(alternative.confidence, 0.0), 1.0),
                }
                for alternative in task.alternatives
            ],
            "recurrence": task.recurrence.model_dump() if task.recurrence else None,
            "subtasks": [{"title": title} for title in task.subtasks],
        }
        for task in wire.tasks
    ]
    return ExtractorPayload.model_validate({"tasks": tasks})
