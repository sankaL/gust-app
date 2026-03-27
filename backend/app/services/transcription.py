from __future__ import annotations

import asyncio
import logging
import random
from dataclasses import dataclass
from time import perf_counter

import httpx

from app.core.errors import ConfigurationError, InvalidConfigurationError
from app.core.settings import Settings

logger = logging.getLogger("gust.api")


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
        provider_status_code: int | None = None,
        provider_error_type: str | None = None,
        provider_error_code: str | None = None,
    ) -> None:
        super().__init__(message)
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
        except httpx.HTTPError as exc:
            raise TranscriptionServiceError("Transcription provider request failed.") from exc

        if response.status_code >= 400:
            provider_error = self._extract_provider_error(response)
            logger.warning(
                "transcription_provider_rejected",
                extra={
                    "event": "transcription_provider_rejected",
                    "provider_status_code": response.status_code,
                    "provider_error_type": provider_error.provider_error_type,
                    "provider_error_code": provider_error.provider_error_code,
                    "audio_filename": filename,
                    "content_type": content_type,
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
                "Transcription provider returned invalid JSON."
            ) from exc
        if not isinstance(payload, dict):
            raise TranscriptionServiceError("Transcription provider returned invalid JSON.")
        transcript_text = payload.get("text")
        if not transcript_text or not str(transcript_text).strip():
            raise TranscriptionServiceError("Transcription provider returned an empty transcript.")

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
            provider_status_code=response.status_code,
            provider_error_type=provider_error_type,
            provider_error_code=provider_error_code,
        )


class MockTranscriptionService:
    """Mock transcription service for local development and testing.

    Returns predictable transcription results without calling external APIs.
    """

    # Generic fallback transcript for unknown filenames
    DEFAULT_TRANSCRIPT = "This is a mock transcription of your audio input."

    # Keywords to mock transcript variations based on filename
    FILENAME_TRANSCRIPT_MAP = {
        "dentist": "Remember to call the dentist tomorrow at 3pm about the checkup appointment.",
        "doctor": "Schedule a follow-up appointment with Dr. Smith next week.",
        "meeting": "Review the quarterly report and prepare questions for the team meeting.",
        "call": "Call back the client regarding the project proposal discussion.",
        "email": "Send follow-up email to the marketing team about the campaign.",
        "presentation": "Prepare slides for the product launch presentation next Friday.",
        "interview": "Practice answers for the technical interview questions.",
        "grocery": "Buy milk, eggs, bread, and vegetables from the grocery store.",
        "birthday": "Remember to buy a gift and send birthday wishes.",
        "flight": "Book the early morning flight to San Francisco for the conference.",
        "dental": "Remember to call the dentist tomorrow at 3pm about the checkup appointment.",
    }

    def _get_transcript_for_filename(self, filename: str) -> str:
        """Return a mock transcript based on keywords in the filename."""
        filename_lower = filename.lower()
        for keyword, transcript in self.FILENAME_TRANSCRIPT_MAP.items():
            if keyword in filename_lower:
                return transcript
        return self.DEFAULT_TRANSCRIPT

    async def transcribe(
        self,
        *,
        audio_bytes: bytes,
        filename: str,
        content_type: str,
    ) -> TranscriptionResult:
        """Mock transcription that returns a contextual transcript based on filename.

        Uses the filename to determine an appropriate mock transcript,
        falling back to a generic placeholder for unknown filenames.
        """
        # Simulate a realistic transcription latency (200-500ms)
        await asyncio.sleep(random.uniform(0.2, 0.5))

        transcript = self._get_transcript_for_filename(filename)

        return TranscriptionResult(
            transcript_text=transcript,
            provider="mock",
            latency_ms=int(random.uniform(200, 500)),
        )
