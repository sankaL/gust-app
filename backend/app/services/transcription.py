from __future__ import annotations

from dataclasses import dataclass
from time import perf_counter

import httpx

from app.core.errors import ConfigurationError
from app.core.settings import Settings


@dataclass
class TranscriptionResult:
    transcript_text: str
    provider: str
    latency_ms: int


class TranscriptionServiceError(Exception):
    pass


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
            raise TranscriptionServiceError("Transcription provider request failed.")

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
