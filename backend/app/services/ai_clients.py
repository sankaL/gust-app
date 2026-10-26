"""Process-wide AI provider clients, opened once per app lifespan."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass

import anthropic
import httpx

from app.core.settings import Settings
from app.services.extraction import build_extraction_client
from app.services.transcription import build_transcription_http_client


@dataclass(frozen=True)
class AIClients:
    transcription: httpx.AsyncClient
    # None when no Anthropic key is configured; the service then fails closed per request.
    extraction: anthropic.AsyncAnthropic | None


@asynccontextmanager
async def open_ai_clients(settings: Settings) -> AsyncIterator[AIClients]:
    """Reuse provider connections across captures so no request pays a fresh TLS handshake."""
    transcription = build_transcription_http_client(settings)
    extraction = build_extraction_client(settings)
    try:
        yield AIClients(transcription=transcription, extraction=extraction)
    finally:
        await transcription.aclose()
        if extraction is not None:
            await extraction.close()
