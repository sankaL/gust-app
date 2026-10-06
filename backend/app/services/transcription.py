from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from time import perf_counter
from typing import Literal

import httpx

from app.core.errors import ConfigurationError, InvalidConfigurationError
from app.core.input_safety import sanitize_for_log
from app.core.settings import Settings

logger = logging.getLogger("gust.api")

TranscriptionFailureReason = Literal[
    "no_speech",
    "timeout",
    "quota_exceeded",
    "provider_unavailable",
    "provider_rejected",
    "provider_invalid_response",
    "unknown",
]

# AssemblyAI reports an exhausted balance as a 400 with this wording rather than a 402.
_QUOTA_ERROR_MARKERS = (
    "account balance is negative",
    "insufficient funds",
    "insufficient credit",
)
_CLEANUP_TIMEOUT_SECONDS = 5.0
_MAX_CONSECUTIVE_TRANSIENT_POLL_FAILURES = 3
# Transcript-level errors that mean the recording contained nothing usable.
_NO_SPEECH_ERROR_MARKERS = ("no spoken audio", "audio duration is too short")


@dataclass
class TranscriptionResult:
    transcript_text: str
    provider: str
    latency_ms: int


class TranscriptionServiceError(Exception):
    def __init__(
        self,
        message: str,
        *,
        failure_reason: TranscriptionFailureReason = "unknown",
        provider_status_code: int | None = None,
        provider_error_type: str | None = None,
        provider_error_code: str | None = None,
    ) -> None:
        super().__init__(message)
        self.failure_reason = failure_reason
        self.provider_status_code = provider_status_code
        self.provider_error_type = provider_error_type
        self.provider_error_code = provider_error_code


class AssemblyAITranscriptionService:
    """Pre-recorded transcription via AssemblyAI: upload, submit, then poll to completion."""

    provider_name = "assemblyai"

    def __init__(
        self,
        settings: Settings,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.settings = settings
        self._transport = transport

    def ensure_configured(self) -> None:
        if not self.settings.assemblyai_api_key or not self.settings.assemblyai_speech_models:
            raise ConfigurationError(
                "Voice transcription is not configured. Please contact the administrator."
            )

    async def transcribe(
        self,
        *,
        audio_bytes: bytes,
        filename: str,
        content_type: str,
    ) -> TranscriptionResult:
        self.ensure_configured()
        started_at = perf_counter()
        deadline_seconds = self.settings.transcription_timeout_seconds

        try:
            async with httpx.AsyncClient(
                base_url=self.settings.assemblyai_api_url.rstrip("/"),
                headers={"authorization": str(self.settings.assemblyai_api_key)},
                timeout=httpx.Timeout(deadline_seconds),
                transport=self._transport,
            ) as client:
                transcript_text = await self._transcribe_with_cleanup(
                    client, audio_bytes, deadline_seconds
                )
        except (TimeoutError, httpx.TimeoutException) as exc:
            raise TranscriptionServiceError(
                "Transcription provider request timed out.",
                failure_reason="timeout",
            ) from exc
        except httpx.TransportError as exc:
            raise TranscriptionServiceError(
                "Transcription provider is unavailable.",
                failure_reason="provider_unavailable",
            ) from exc
        except httpx.HTTPError as exc:
            raise TranscriptionServiceError(
                "Transcription provider request failed.",
                failure_reason="unknown",
            ) from exc
        except TranscriptionServiceError as exc:
            self._log_provider_failure(
                exc, filename=filename, content_type=content_type, audio_size=len(audio_bytes)
            )
            raise

        latency_ms = int((perf_counter() - started_at) * 1000)
        return TranscriptionResult(
            transcript_text=transcript_text,
            provider=self.provider_name,
            latency_ms=latency_ms,
        )

    async def _transcribe_with_cleanup(
        self,
        client: httpx.AsyncClient,
        audio_bytes: bytes,
        deadline_seconds: float,
    ) -> str:
        transcript_id: str | None = None
        try:
            async with asyncio.timeout(deadline_seconds):
                upload_url = await self._upload(client, audio_bytes)
                transcript_id = await self._submit(client, upload_url)
                return await self._poll(client, transcript_id)
        finally:
            # Raw audio must not outlive processing; deleting the transcript also
            # deletes the uploaded file on AssemblyAI's side.
            if transcript_id is not None:
                await self._delete_transcript(client, transcript_id)

    async def _delete_transcript(self, client: httpx.AsyncClient, transcript_id: str) -> None:
        status_code: int | None = None
        try:
            async with asyncio.timeout(_CLEANUP_TIMEOUT_SECONDS):
                response = await client.delete(f"/v2/transcript/{transcript_id}")
            if response.status_code < 400:
                return
            status_code = response.status_code
        except (TimeoutError, httpx.HTTPError):
            pass
        logger.warning(
            "transcription_provider_cleanup_failed",
            extra={
                "event": "transcription_provider_cleanup_failed",
                "provider": self.provider_name,
                "provider_status_code": status_code,
            },
        )

    async def _upload(self, client: httpx.AsyncClient, audio_bytes: bytes) -> str:
        response = await client.post(
            "/v2/upload",
            content=audio_bytes,
            headers={"content-type": "application/octet-stream"},
        )
        payload = self._checked_payload(response)
        upload_url = payload.get("upload_url")
        if not isinstance(upload_url, str) or not upload_url:
            raise TranscriptionServiceError(
                "Transcription provider returned an invalid upload response.",
                failure_reason="provider_invalid_response",
            )
        return upload_url

    async def _submit(self, client: httpx.AsyncClient, upload_url: str) -> str:
        response = await client.post(
            "/v2/transcript",
            json={
                "audio_url": upload_url,
                "speech_models": list(self.settings.assemblyai_speech_models),
            },
        )
        payload = self._checked_payload(response)
        transcript_id = payload.get("id")
        if not isinstance(transcript_id, str) or not transcript_id:
            raise TranscriptionServiceError(
                "Transcription provider returned an invalid submit response.",
                failure_reason="provider_invalid_response",
            )
        return transcript_id

    async def _poll(self, client: httpx.AsyncClient, transcript_id: str) -> str:
        # Bounded by the asyncio.timeout deadline wrapping the whole transcription.
        # The job is already submitted (and billed), so ride out brief poll hiccups.
        consecutive_transient_failures = 0
        while True:
            try:
                payload = self._checked_payload(await client.get(f"/v2/transcript/{transcript_id}"))
            except (httpx.TransportError, TranscriptionServiceError) as exc:
                consecutive_transient_failures += 1
                if (
                    not _is_transient_poll_failure(exc)
                    or consecutive_transient_failures > _MAX_CONSECUTIVE_TRANSIENT_POLL_FAILURES
                ):
                    raise
            else:
                consecutive_transient_failures = 0
                transcript_text = self._terminal_transcript_text(payload)
                if transcript_text is not None:
                    return transcript_text
            await asyncio.sleep(self.settings.assemblyai_poll_interval_seconds)

    def _terminal_transcript_text(self, payload: dict[str, object]) -> str | None:
        status = payload.get("status")
        if status == "completed":
            return self._completed_text(payload)
        if status == "error":
            raise self._transcript_error(payload)
        if status not in {"queued", "processing"}:
            raise TranscriptionServiceError(
                "Transcription provider returned an unknown status.",
                failure_reason="provider_invalid_response",
            )
        return None

    def _checked_payload(self, response: httpx.Response) -> dict[str, object]:
        if response.status_code >= 400:
            self._raise_for_provider_status(response)
        try:
            payload = response.json()
        except ValueError as exc:
            raise TranscriptionServiceError(
                "Transcription provider returned invalid JSON.",
                failure_reason="provider_invalid_response",
            ) from exc
        if not isinstance(payload, dict):
            raise TranscriptionServiceError(
                "Transcription provider returned invalid JSON.",
                failure_reason="provider_invalid_response",
            )
        return payload

    def _raise_for_provider_status(self, response: httpx.Response) -> None:
        status_code = response.status_code
        provider_message = _provider_error_message(response).lower()

        if status_code == 402 or any(marker in provider_message for marker in _QUOTA_ERROR_MARKERS):
            failure_reason: TranscriptionFailureReason = "quota_exceeded"
        elif status_code in {401, 403}:
            logger.warning(
                "transcription_provider_auth_failed",
                extra={
                    "event": "transcription_provider_auth_failed",
                    "provider": self.provider_name,
                    "provider_status_code": status_code,
                },
            )
            raise InvalidConfigurationError(
                "Voice transcription is not configured correctly. Please contact the administrator."
            )
        elif status_code == 429 or status_code >= 500:
            failure_reason = "provider_unavailable"
        else:
            failure_reason = "provider_rejected"

        raise TranscriptionServiceError(
            "Transcription provider request failed.",
            failure_reason=failure_reason,
            provider_status_code=status_code,
        )

    def _completed_text(self, payload: dict[str, object]) -> str:
        transcript_text = payload.get("text")
        if not isinstance(transcript_text, str) or not transcript_text.strip():
            raise TranscriptionServiceError(
                "Transcription provider returned an empty transcript.",
                failure_reason="no_speech",
            )
        return transcript_text.strip()

    def _transcript_error(self, payload: dict[str, object]) -> TranscriptionServiceError:
        raw_error = payload.get("error")
        error_text = raw_error.lower() if isinstance(raw_error, str) else ""
        if any(marker in error_text for marker in _NO_SPEECH_ERROR_MARKERS):
            failure_reason: TranscriptionFailureReason = "no_speech"
        elif any(marker in error_text for marker in _QUOTA_ERROR_MARKERS):
            failure_reason = "quota_exceeded"
        else:
            failure_reason = "provider_rejected"
        return TranscriptionServiceError(
            "Transcription provider could not transcribe the recording.",
            failure_reason=failure_reason,
            provider_error_type="transcript_error",
        )

    def _log_provider_failure(
        self,
        exc: TranscriptionServiceError,
        *,
        filename: str,
        content_type: str,
        audio_size: int,
    ) -> None:
        logger.warning(
            "transcription_provider_rejected",
            extra={
                "event": "transcription_provider_rejected",
                "provider": self.provider_name,
                "failure_reason": exc.failure_reason,
                "provider_status_code": exc.provider_status_code,
                "provider_error_type": exc.provider_error_type,
                "audio_filename_extension": _filename_extension(filename),
                "content_type": sanitize_for_log(content_type, max_length=80),
                "audio_size_bytes": audio_size,
            },
        )


def _is_transient_poll_failure(exc: Exception) -> bool:
    # A per-request timeout means the overall deadline is spent, so it is not retried.
    if isinstance(exc, httpx.TimeoutException):
        return False
    if isinstance(exc, httpx.TransportError):
        return True
    return (
        isinstance(exc, TranscriptionServiceError) and exc.failure_reason == "provider_unavailable"
    )


def _provider_error_message(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return ""
    if isinstance(payload, dict) and isinstance(payload.get("error"), str):
        return payload["error"]
    return ""


def _filename_extension(filename: str) -> str | None:
    lowered = filename.lower()
    if "." not in lowered:
        return None
    extension = lowered.rsplit(".", maxsplit=1)[-1]
    return extension[:16] if extension else None
