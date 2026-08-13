from __future__ import annotations

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
    "provider_unavailable",
    "provider_rejected",
    "provider_invalid_response",
    "unknown",
]


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


class MistralTranscriptionService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def ensure_configured(self) -> None:
        if not self.settings.mistral_api_key:
            raise ConfigurationError("Mistral transcription configuration is missing.")

    async def transcribe(
        self,
        *,
        audio_bytes: bytes,
        filename: str,
        content_type: str,
    ) -> TranscriptionResult:
        self.ensure_configured()
        started_at = perf_counter()

        headers = {"Authorization": f"Bearer {self.settings.mistral_api_key}"}
        files = {"file": (filename, audio_bytes, content_type)}
        data = {"model": self.settings.mistral_transcription_model}

        timeout = httpx.Timeout(self.settings.transcription_timeout_seconds)
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(
                    self.settings.mistral_api_url,
                    headers=headers,
                    data=data,
                    files=files,
                )
        except httpx.TimeoutException as exc:
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

        if response.status_code >= 400:
            provider_error = self._extract_provider_error(response)
            logger.warning(
                "transcription_provider_rejected",
                extra={
                    "event": "transcription_provider_rejected",
                    "failure_reason": provider_error.failure_reason,
                    "provider_status_code": response.status_code,
                    "provider_error_type": provider_error.provider_error_type,
                    "provider_error_code": provider_error.provider_error_code,
                    "audio_filename_extension": _filename_extension(filename),
                    "content_type": sanitize_for_log(content_type, max_length=80),
                    "audio_size_bytes": len(audio_bytes),
                },
            )
            if provider_error.provider_error_type == "invalid_model":
                raise InvalidConfigurationError(
                    "Configured Mistral transcription model is invalid."
                )
            if response.status_code in {401, 403}:
                raise InvalidConfigurationError("Configured Mistral credentials are invalid.")
            raise provider_error

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
        transcript_text = payload.get("text")
        if not transcript_text or not str(transcript_text).strip():
            raise TranscriptionServiceError(
                "Transcription provider returned an empty transcript.",
                failure_reason="no_speech",
            )

        latency_ms = int((perf_counter() - started_at) * 1000)
        return TranscriptionResult(
            transcript_text=str(transcript_text).strip(),
            provider="mistral",
            latency_ms=latency_ms,
        )

    def _extract_provider_error(self, response: httpx.Response) -> TranscriptionServiceError:
        provider_error_type: str | None = None
        provider_error_code: str | None = None
        provider_message = "Transcription provider request failed."
        if response.status_code == 429 or response.status_code >= 500:
            failure_reason: TranscriptionFailureReason = "provider_unavailable"
        else:
            failure_reason = "provider_rejected"
        try:
            payload = response.json()
        except ValueError:
            payload = None

        if isinstance(payload, dict):
            raw_message = payload.get("message")
            raw_type = payload.get("type")
            raw_code = payload.get("code")
            if isinstance(raw_message, str) and raw_message.strip():
                provider_message = raw_message.strip()
            if isinstance(raw_type, str) and raw_type.strip():
                provider_error_type = raw_type.strip()
            if isinstance(raw_code, str) and raw_code.strip():
                provider_error_code = raw_code.strip()

        return TranscriptionServiceError(
            provider_message,
            failure_reason=failure_reason,
            provider_status_code=response.status_code,
            provider_error_type=provider_error_type,
            provider_error_code=provider_error_code,
        )

def _filename_extension(filename: str) -> str | None:
    lowered = filename.lower()
    if "." not in lowered:
        return None
    extension = lowered.rsplit(".", maxsplit=1)[-1]
    return extension[:16] if extension else None
