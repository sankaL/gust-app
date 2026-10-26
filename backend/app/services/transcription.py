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
    "quota_exceeded",
    "provider_unavailable",
    "provider_rejected",
    "provider_invalid_response",
    "unknown",
]

# Mistral reports an unpaid or exhausted account in the error message rather than a fixed code.
_QUOTA_ERROR_MARKERS = (
    "insufficient funds",
    "insufficient credit",
    "credit balance",
    "billing",
    "payment required",
)


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


def build_transcription_http_client(settings: Settings) -> httpx.AsyncClient:
    """Long-lived client so each capture reuses an open TLS connection to Mistral."""
    return httpx.AsyncClient(
        timeout=httpx.Timeout(settings.transcription_timeout_seconds),
        limits=httpx.Limits(max_keepalive_connections=5, keepalive_expiry=300.0),
    )


class MistralTranscriptionService:
    """Synchronous single-request transcription via Mistral Voxtral."""

    provider_name = "mistral"

    def __init__(
        self,
        settings: Settings,
        *,
        client: httpx.AsyncClient | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.settings = settings
        self._client = client
        self._transport = transport

    def ensure_configured(self) -> None:
        if not self.settings.mistral_api_key or not self.settings.mistral_transcription_model:
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

        try:
            if self._client is not None:
                response = await self._post(self._client, audio_bytes, filename, content_type)
            else:
                async with httpx.AsyncClient(
                    timeout=httpx.Timeout(self.settings.transcription_timeout_seconds),
                    transport=self._transport,
                ) as client:
                    response = await self._post(client, audio_bytes, filename, content_type)
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

        try:
            transcript_text = self._transcript_text(response)
        except TranscriptionServiceError as exc:
            self._log_provider_failure(
                exc, filename=filename, content_type=content_type, audio_size=len(audio_bytes)
            )
            raise

        return TranscriptionResult(
            transcript_text=transcript_text,
            provider=self.provider_name,
            latency_ms=int((perf_counter() - started_at) * 1000),
        )

    async def _post(
        self,
        client: httpx.AsyncClient,
        audio_bytes: bytes,
        filename: str,
        content_type: str,
    ) -> httpx.Response:
        return await client.post(
            self.settings.mistral_api_url,
            headers={"Authorization": f"Bearer {self.settings.mistral_api_key}"},
            data={"model": self.settings.mistral_transcription_model},
            files={"file": (filename, audio_bytes, content_type)},
            timeout=self.settings.transcription_timeout_seconds,
        )

    def _transcript_text(self, response: httpx.Response) -> str:
        if response.status_code >= 400:
            raise self._provider_error(response)
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
        if not isinstance(transcript_text, str) or not transcript_text.strip():
            raise TranscriptionServiceError(
                "Transcription provider returned an empty transcript.",
                failure_reason="no_speech",
            )
        return transcript_text.strip()

    def _provider_error(self, response: httpx.Response) -> Exception:
        status_code = response.status_code
        message, error_type, error_code = _provider_error_details(response)
        lowered = message.lower()

        if status_code in {401, 403} or error_type == "invalid_model":
            logger.warning(
                "transcription_provider_auth_failed",
                extra={
                    "event": "transcription_provider_auth_failed",
                    "provider": self.provider_name,
                    "provider_status_code": status_code,
                    "provider_error_type": error_type,
                },
            )
            return InvalidConfigurationError(
                "Voice transcription is not configured correctly. Please contact the administrator."
            )
        if status_code == 402 or any(marker in lowered for marker in _QUOTA_ERROR_MARKERS):
            failure_reason: TranscriptionFailureReason = "quota_exceeded"
        elif status_code == 429 or status_code >= 500:
            failure_reason = "provider_unavailable"
        else:
            failure_reason = "provider_rejected"

        return TranscriptionServiceError(
            "Transcription provider request failed.",
            failure_reason=failure_reason,
            provider_status_code=status_code,
            provider_error_type=error_type,
            provider_error_code=error_code,
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
                "provider_error_code": exc.provider_error_code,
                "audio_filename_extension": _filename_extension(filename),
                "content_type": sanitize_for_log(content_type, max_length=80),
                "audio_size_bytes": audio_size,
            },
        )


def _provider_error_details(response: httpx.Response) -> tuple[str, str | None, str | None]:
    try:
        payload = response.json()
    except ValueError:
        return "", None, None
    if not isinstance(payload, dict):
        return "", None, None
    message = payload.get("message")
    error_type = payload.get("type")
    error_code = payload.get("code")
    return (
        message if isinstance(message, str) else "",
        error_type.strip() if isinstance(error_type, str) and error_type.strip() else None,
        str(error_code).strip() if isinstance(error_code, (str, int)) else None,
    )


def _filename_extension(filename: str) -> str | None:
    lowered = filename.lower()
    if "." not in lowered:
        return None
    extension = lowered.rsplit(".", maxsplit=1)[-1]
    return extension[:16] if extension else None
