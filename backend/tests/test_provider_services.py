import asyncio
from dataclasses import dataclass
from datetime import date, datetime
from typing import Optional

import httpx
import pytest

from app.core.errors import InvalidConfigurationError
from app.core.settings import Settings
from app.services.extraction import (
    ExtractionRequest,
    ExtractionServiceError,
    ExtractorMalformedResponseError,
    OpenRouterExtractionService,
)
from app.services.reminders import ReminderDeliveryError, ResendReminderService
from app.services.transcription import MistralTranscriptionService, TranscriptionServiceError


class FakeAsyncClient:
    def __init__(self, *, response=None, error: Optional[Exception] = None) -> None:
        self.response = response
        self.error = error
        self.post_calls: list[dict[str, object]] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def post(self, *args, **kwargs):
        self.post_calls.append({"args": args, "kwargs": kwargs})
        if self.error is not None:
            raise self.error
        return self.response


@dataclass
class FakeJsonResponse:
    status_code: int
    json_value: Optional[object] = None
    json_error: Optional[Exception] = None

    def json(self):
        if self.json_error is not None:
            raise self.json_error
        return self.json_value


def build_settings() -> Settings:
    return Settings.model_validate(
        {
            "APP_ENV": "test",
            "DATABASE_URL": "sqlite+pysqlite:///:memory:",
            "FRONTEND_APP_URL": "http://frontend.test",
            "BACKEND_PUBLIC_URL": "http://testserver",
            "SUPABASE_URL": "http://supabase.test",
            "SUPABASE_ANON_KEY": "test-anon-key",
            "MISTRAL_API_KEY": "mistral-key",
            "OPENROUTER_API_KEY": "openrouter-key",
            "RESEND_API_KEY": "resend-key",
            "RESEND_FROM_EMAIL": "gust@example.com",
            "RUN_STARTUP_CHECKS": False,
            "SESSION_COOKIE_SECURE": False,
        }
    )


def test_transcription_service_wraps_http_transport_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = MistralTranscriptionService(build_settings())
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda timeout: FakeAsyncClient(error=httpx.ReadTimeout("timeout")),
    )

    with pytest.raises(TranscriptionServiceError):
        asyncio.run(
            service.transcribe(
                audio_bytes=b"voice-bytes",
                filename="capture.webm",
                content_type="audio/webm",
            )
        )


def test_transcription_service_wraps_invalid_json_responses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = MistralTranscriptionService(build_settings())
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda timeout: FakeAsyncClient(
            response=FakeJsonResponse(status_code=200, json_error=ValueError("bad json"))
        ),
    )

    with pytest.raises(TranscriptionServiceError):
        asyncio.run(
            service.transcribe(
                audio_bytes=b"voice-bytes",
                filename="capture.webm",
                content_type="audio/webm",
            )
        )


def test_transcription_service_uses_expected_default_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = MistralTranscriptionService(build_settings())
    client = FakeAsyncClient(
        response=FakeJsonResponse(status_code=200, json_value={"text": "Buy coffee"})
    )
    monkeypatch.setattr(httpx, "AsyncClient", lambda timeout: client)

    result = asyncio.run(
        service.transcribe(
            audio_bytes=b"voice-bytes",
            filename="capture.webm",
            content_type="audio/webm",
        )
    )

    assert result.transcript_text == "Buy coffee"
    assert result.provider == "mistral"
    assert len(client.post_calls) == 1
    request_kwargs = client.post_calls[0]["kwargs"]
    assert request_kwargs["data"] == {"model": "voxtral-mini-latest"}
    assert request_kwargs["files"] == {"file": ("capture.webm", b"voice-bytes", "audio/webm")}


def test_transcription_service_maps_invalid_model_to_invalid_configuration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = MistralTranscriptionService(build_settings())
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda timeout: FakeAsyncClient(
            response=FakeJsonResponse(
                status_code=400,
                json_value={
                    "message": "Invalid model: voxtral-mini-transcribe-26-02",
                    "type": "invalid_model",
                    "code": "1500",
                },
            )
        ),
    )

    with pytest.raises(InvalidConfigurationError):
        asyncio.run(
            service.transcribe(
                audio_bytes=b"voice-bytes",
                filename="capture.webm",
                content_type="audio/webm",
            )
        )


def test_extraction_service_wraps_http_transport_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = OpenRouterExtractionService(build_settings())
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda timeout: FakeAsyncClient(error=httpx.ConnectError("offline")),
    )

    with pytest.raises(ExtractionServiceError):
        asyncio.run(
            service.extract(
                request=ExtractionRequest(
                    transcript_text="Plan trip",
                    user_timezone="UTC",
                    current_local_date=date(2026, 3, 22),
                    groups=[],
                ),
                schema={"type": "object"},
            )
        )


def test_extraction_service_wraps_invalid_json_responses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = OpenRouterExtractionService(build_settings())
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda timeout: FakeAsyncClient(
            response=FakeJsonResponse(status_code=200, json_error=ValueError("bad json"))
        ),
    )

    with pytest.raises(ExtractorMalformedResponseError):
        asyncio.run(
            service.extract(
                request=ExtractionRequest(
                    transcript_text="Plan trip",
                    user_timezone="UTC",
                    current_local_date=date(2026, 3, 22),
                    groups=[],
                ),
                schema={"type": "object"},
            )
        )


def test_extraction_service_uses_expected_default_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = OpenRouterExtractionService(build_settings())
    client = FakeAsyncClient(
        response=FakeJsonResponse(
            status_code=200,
            json_value={"choices": [{"message": {"content": '{"tasks": []}'}}]},
        )
    )
    monkeypatch.setattr(httpx, "AsyncClient", lambda timeout: client)

    payload = asyncio.run(
        service.extract(
            request=ExtractionRequest(
                transcript_text="Plan trip",
                user_timezone="UTC",
                current_local_date=date(2026, 3, 22),
                groups=[],
            ),
            schema={"type": "object", "properties": {"tasks": {"type": "array"}}},
        )
    )

    assert payload == {"tasks": []}
    assert len(client.post_calls) == 1
    request_kwargs = client.post_calls[0]["kwargs"]
    assert request_kwargs["json"]["model"] == "openai/gpt-5.4-mini"
    assert request_kwargs["json"]["response_format"]["type"] == "json_schema"
    assert request_kwargs["json"]["response_format"]["json_schema"]["schema"]["required"] == ["tasks"]


def test_extraction_service_normalizes_nested_schema_for_strict_outputs() -> None:
    service = OpenRouterExtractionService(build_settings())
    normalized = service._normalize_schema_for_strict_outputs(
        {
            "type": "object",
            "properties": {
                "tasks": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "due_date": {
                                "anyOf": [{"type": "string"}, {"type": "null"}],
                                "default": None,
                            },
                        },
                        "required": ["title"],
                    },
                }
            },
            "required": ["tasks"],
        }
    )

    item_schema = normalized["properties"]["tasks"]["items"]
    assert item_schema["required"] == ["title", "due_date"]
    assert "default" not in item_schema["properties"]["due_date"]


def test_extraction_service_accepts_fenced_json_content(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = OpenRouterExtractionService(build_settings())
    client = FakeAsyncClient(
        response=FakeJsonResponse(
            status_code=200,
            json_value={
                "choices": [
                    {
                        "message": {
                            "content": '```json\n{"tasks": []}\n```',
                        }
                    }
                ]
            },
        )
    )
    monkeypatch.setattr(httpx, "AsyncClient", lambda timeout: client)

    payload = asyncio.run(
        service.extract(
            request=ExtractionRequest(
                transcript_text="Plan trip",
                user_timezone="UTC",
                current_local_date=date(2026, 3, 22),
                groups=[],
            ),
            schema={"type": "object", "properties": {"tasks": {"type": "array"}}},
        )
    )

    assert payload == {"tasks": []}


def test_resend_service_wraps_transport_failures_as_retryable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = ResendReminderService(build_settings())
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda timeout: FakeAsyncClient(error=httpx.ReadTimeout("timeout")),
    )

    with pytest.raises(ReminderDeliveryError) as exc_info:
        asyncio.run(
            service.send(
                to_email="user@example.com",
                task_title="Pay rent",
                due_date=date(2026, 3, 24),
                scheduled_for=datetime(2026, 3, 24, 9, 0),
                idempotency_key="task:1",
            )
        )

    assert exc_info.value.retryable is True


def test_resend_service_marks_provider_rejections_as_terminal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = ResendReminderService(build_settings())
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda timeout: FakeAsyncClient(response=FakeJsonResponse(status_code=400, json_value={})),
    )

    with pytest.raises(ReminderDeliveryError) as exc_info:
        asyncio.run(
            service.send(
                to_email="user@example.com",
                task_title="Pay rent",
                due_date=date(2026, 3, 24),
                scheduled_for=datetime(2026, 3, 24, 9, 0),
                idempotency_key="task:1",
            )
        )

    assert exc_info.value.retryable is False


def test_resend_service_returns_provider_message_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = ResendReminderService(build_settings())
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda timeout: FakeAsyncClient(
            response=FakeJsonResponse(status_code=200, json_value={"id": "provider-msg-123"})
        ),
    )

    result = asyncio.run(
        service.send(
            to_email="user@example.com",
            task_title="Pay rent",
            due_date=date(2026, 3, 24),
            scheduled_for=datetime(2026, 3, 24, 9, 0),
            idempotency_key="task:1",
        )
    )

    assert result.provider_message_id == "provider-msg-123"


def test_resend_service_escapes_task_title_in_html_body() -> None:
    service = ResendReminderService(build_settings())

    body = service._build_html_body(
        task_title='</p><a href="https://evil.test">click me</a>',
        due_date=date(2026, 3, 24),
        scheduled_for=datetime(2026, 3, 24, 9, 0),
    )

    assert '</p><a href="https://evil.test">click me</a>' not in body
    assert "&lt;/p&gt;&lt;a href=&quot;https://evil.test&quot;&gt;click me&lt;/a&gt;" in body
