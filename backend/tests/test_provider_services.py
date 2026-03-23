import asyncio
from dataclasses import dataclass
from datetime import date, datetime
import logging
from typing import Optional
from unittest.mock import patch

import httpx
import pytest

from app.core.errors import ConfigurationError, InvalidConfigurationError
from app.core.settings import Settings
from app.prompts.extraction_prompts import ExtractionPromptManager
from app.services.extraction import (
    ExtractionRequest,
    ExtractorMalformedResponseError,
    ExtractionServiceError,
    LangChainExtractionService,
)
from app.services.extraction_models import (
    ExtractionModelConfig,
    ExtractionModelRegistry,
    ExtractorPayload,
)
from app.services.extraction_retry import (
    ExtractionRetryError,
    ExtractionRetryManager,
    RetryConfig,
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


def test_extraction_service_chain_error_raises_service_error() -> None:
    """Extraction propagates chain errors as ExtractionServiceError after retries."""
    settings = build_settings()
    registry = ExtractionModelRegistry.default("openai/gpt-5.4-mini")

    service = LangChainExtractionService(
        settings=settings,
        model_registry=registry,
    )

    # Mock the chain to always fail
    async def fail_invoke(*args, **kwargs):
        raise RuntimeError("chain failed")

    with patch.object(service, "_execute_extraction", side_effect=fail_invoke):
        with pytest.raises(ExtractionServiceError):
            asyncio.run(
                service.extract(
                    request=ExtractionRequest(
                        transcript_text="Plan trip",
                        user_timezone="UTC",
                        current_local_date=date(2026, 3, 22),
                        groups=[],
                    ),
                )
            )


def test_extraction_service_invalid_json_raises_malformed_error() -> None:
    """Extraction wraps malformed JSON responses as ExtractionServiceError."""
    settings = build_settings()
    registry = ExtractionModelRegistry.default("openai/gpt-5.4-mini")

    service = LangChainExtractionService(
        settings=settings,
        model_registry=registry,
    )

    async def return_invalid_json(*args, **kwargs):
        return "not valid json {"

    with patch.object(service, "_execute_extraction", side_effect=return_invalid_json):
        with pytest.raises(ExtractionServiceError):
            asyncio.run(
                service.extract(
                    request=ExtractionRequest(
                        transcript_text="Plan trip",
                        user_timezone="UTC",
                        current_local_date=date(2026, 3, 22),
                        groups=[],
                    ),
                )
            )


def test_extraction_service_missing_api_key_raises_config_error() -> None:
    """Extraction raises ConfigurationError when API key is missing."""
    settings = build_settings()
    settings.openrouter_api_key = None
    service = LangChainExtractionService(settings=settings)

    with pytest.raises(ConfigurationError):
        asyncio.run(
            service.extract(
                request=ExtractionRequest(
                    transcript_text="Plan trip",
                    user_timezone="UTC",
                    current_local_date=date(2026, 3, 22),
                    groups=[],
                ),
            )
        )


def test_extraction_service_uses_correct_model_from_registry() -> None:
    """Extraction selects model from registry and uses it for LLM creation."""
    settings = build_settings()
    registry = ExtractionModelRegistry.default("anthropic/claude-3.5-sonnet")

    service = LangChainExtractionService(
        settings=settings,
        model_registry=registry,
    )

    # Mock the LLM creation to capture the model config
    created_configs = []
    original_create = service._create_llm

    def tracking_create_llm(model_config):
        created_configs.append(model_config)
        return original_create(model_config)

    # Mock the chain execution
    async def mock_execute(*args, **kwargs):
        return {"tasks": []}

    with patch.object(service, "_create_llm", side_effect=tracking_create_llm):
        with patch.object(service, "_execute_extraction", side_effect=mock_execute):
            asyncio.run(
                service.extract(
                    request=ExtractionRequest(
                        transcript_text="Plan trip",
                        user_timezone="UTC",
                        current_local_date=date(2026, 3, 22),
                        groups=[],
                    ),
                )
            )

    assert len(created_configs) == 1
    assert created_configs[0].model_id == "anthropic/claude-3.5-sonnet"


def test_extraction_service_tracks_attempt_count_across_retries() -> None:
    """Extraction service exposes the number of attempts used for a request."""
    settings = build_settings()
    service = LangChainExtractionService(settings=settings)

    call_count = 0

    async def fail_once_then_succeed(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise RuntimeError("temporary failure")
        return {"tasks": []}

    with patch.object(service, "_execute_extraction", side_effect=fail_once_then_succeed):
        result = asyncio.run(
            service.extract(
                request=ExtractionRequest(
                    transcript_text="Plan trip",
                    user_timezone="UTC",
                    current_local_date=date(2026, 3, 22),
                    groups=[],
                ),
            )
        )

    assert result == {"tasks": []}
    assert service.last_attempt_count == 2


def test_extraction_service_parses_valid_dict_result() -> None:
    """Extraction returns dict results directly without parsing."""
    expected_payload = {"tasks": [{"title": "Buy milk", "due_date": None}]}
    service = LangChainExtractionService(settings=build_settings())
    result = service._parse_result(expected_payload)

    assert result == expected_payload


def test_extraction_service_strips_fenced_json() -> None:
    """Extraction strips JSON fence markers from string results."""
    service = LangChainExtractionService(settings=build_settings())
    fenced_json = '```json\n{"tasks": []}\n```'
    result = service._parse_result(fenced_json)

    assert result == {"tasks": []}


def test_extraction_prompt_manager_includes_transcript_delimiters() -> None:
    """Prompt manager wraps transcript in delimiters to reduce injection risk."""
    manager = ExtractionPromptManager()
    prompt = manager.get_user_prompt(
        user_timezone="UTC",
        current_local_date=date(2026, 3, 22),
        groups=[],
        transcript_text="Buy groceries",
    )

    assert "---BEGIN TRANSCRIPT---" in prompt
    assert "---END TRANSCRIPT---" in prompt
    assert "Buy groceries" in prompt


def test_extraction_prompt_manager_does_not_request_needs_review_field() -> None:
    """System prompt should not require fields outside the extraction schema."""
    manager = ExtractionPromptManager()
    prompt = manager.get_system_prompt()

    assert "needs_review" not in prompt


def test_extraction_prompt_manager_keeps_json_example_valid() -> None:
    """System prompt should show valid JSON syntax to the model."""
    manager = ExtractionPromptManager()
    prompt = manager.get_system_prompt()

    assert "{{" not in prompt
    assert "}}" not in prompt


def test_extraction_prompt_manager_formats_groups() -> None:
    """Prompt manager includes group metadata in the prompt."""
    manager = ExtractionPromptManager()
    prompt = manager.get_user_prompt(
        user_timezone="America/New_York",
        current_local_date=date(2026, 3, 22),
        groups=[
            {
                "id": "abc-123",
                "name": "Shopping",
                "description": "Grocery runs",
                "recent_task_titles": ["Buy milk", "Buy eggs"],
            }
        ],
        transcript_text="Buy bread",
    )

    assert "Shopping" in prompt
    assert "abc-123" in prompt
    assert "Grocery runs" in prompt
    assert "Buy milk, Buy eggs" in prompt


def test_extraction_prompt_manager_falls_back_to_inbox() -> None:
    """Prompt manager uses Inbox when no groups are provided."""
    manager = ExtractionPromptManager()
    prompt = manager.get_user_prompt(
        user_timezone="UTC",
        current_local_date=date(2026, 3, 22),
        groups=[],
        transcript_text="Plan trip",
    )

    assert "- Inbox" in prompt


def test_extraction_service_debug_log_omits_api_key_prefix(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Debug logging should not emit credential material."""
    settings = build_settings()
    service = LangChainExtractionService(settings=settings)
    model_config = service.model_registry.select_model()

    with caplog.at_level(logging.DEBUG, logger="gust.api"):
        service._create_llm(model_config)

    config_logs = [record for record in caplog.records if record.msg == "extraction_llm_config"]

    assert len(config_logs) == 1
    assert not hasattr(config_logs[0], "api_key_prefix")


def test_extraction_parse_error_log_omits_raw_provider_content(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Malformed JSON logging should not include raw model output."""
    service = LangChainExtractionService(settings=build_settings())
    malformed = 'not valid json {"secret":"user-task"}'

    with caplog.at_level(logging.WARNING, logger="gust.api"):
        with pytest.raises(ExtractorMalformedResponseError):
            service._parse_result(malformed)

    parse_logs = [record for record in caplog.records if record.msg == "extraction_parse_error"]
    assert len(parse_logs) == 1
    assert not hasattr(parse_logs[0], "content_preview")
    assert "user-task" not in caplog.text


def test_extraction_service_passes_system_prompt_as_runtime_input(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """System prompt JSON examples should not be parsed as template variables."""
    settings = build_settings()
    service = LangChainExtractionService(settings=settings)
    captured: dict[str, object] = {}

    class FakeChain:
        def __or__(self, other):
            return self

        async def ainvoke(self, payload):
            captured["payload"] = payload
            return {"tasks": []}

    fake_chain = FakeChain()
    captured_messages: dict[str, object] = {}

    def fake_from_messages(messages):
        captured_messages["messages"] = messages
        return fake_chain

    monkeypatch.setattr(
        "app.services.extraction.ChatPromptTemplate.from_messages",
        fake_from_messages,
    )

    result = asyncio.run(
        service._execute_extraction(
            request=ExtractionRequest(
                transcript_text="Buy groceries",
                user_timezone="UTC",
                current_local_date=date(2026, 3, 22),
                groups=[],
            ),
            model_config=service.model_registry.select_model(),
            llm=object(),
        )
    )

    assert result == {"tasks": []}
    assert captured_messages["messages"] == [
        ("system", "{system_prompt}"),
        ("user", "{user_input}"),
    ]
    assert captured["payload"] == {
        "system_prompt": service.prompt_manager.get_system_prompt(),
        "user_input": service.prompt_manager.get_user_prompt(
            user_timezone="UTC",
            current_local_date=date(2026, 3, 22),
            groups=[],
            transcript_text="Buy groceries",
        ),
    }


def test_extractor_payload_allows_invalid_recurrence_for_candidate_filtering() -> None:
    """Payload validation should allow capture service to reject malformed candidates individually."""
    payload = ExtractorPayload.model_validate(
        {
            "tasks": [
                {
                    "title": "Review sprint goals",
                    "due_date": None,
                    "reminder_at": None,
                    "group_id": None,
                    "group_name": None,
                    "top_confidence": 0.7,
                    "alternative_groups": [],
                    "recurrence": {
                        "frequency": "yearly",
                        "weekday": 99,
                        "day_of_month": 44,
                    },
                    "subtasks": [],
                }
            ]
        }
    )

    recurrence = payload.tasks[0].recurrence
    assert recurrence is not None
    assert recurrence.frequency == "yearly"


# --- ExtractionRetryManager tests ---


@pytest.mark.asyncio
async def test_retry_manager_succeeds_on_first_attempt() -> None:
    """Retry manager returns result on first successful attempt."""
    manager = ExtractionRetryManager(RetryConfig(max_retries=3))

    async def succeed_fn(*args, **kwargs):
        return {"tasks": [{"title": "test"}]}

    def identity_validator(result):
        return result

    result = await manager.execute_with_retry(succeed_fn, identity_validator)
    assert result == {"tasks": [{"title": "test"}]}
    assert manager.last_attempt_count == 1


@pytest.mark.asyncio
async def test_retry_manager_retries_on_validation_error() -> None:
    """Retry manager retries when validator raises ValidationError."""
    manager = ExtractionRetryManager(RetryConfig(max_retries=3, base_delay=0.01))

    call_count = 0

    async def eventually_succeed(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count < 2:
            return "invalid"
        return {"tasks": []}

    def validate_as_extractor_payload(result):
        return ExtractorPayload.model_validate(result)

    result = await manager.execute_with_retry(eventually_succeed, validate_as_extractor_payload)
    assert isinstance(result, ExtractorPayload)
    assert result.model_dump() == {"tasks": []}
    assert call_count == 2
    assert manager.last_attempt_count == 2


@pytest.mark.asyncio
async def test_retry_manager_raises_after_max_retries() -> None:
    """Retry manager raises ExtractionRetryError after exhausting retries."""
    manager = ExtractionRetryManager(RetryConfig(max_retries=2, base_delay=0.01))

    async def always_fail(*args, **kwargs):
        raise RuntimeError("always fails")

    def identity_validator(result):
        return result

    with pytest.raises(ExtractionRetryError):
        await manager.execute_with_retry(always_fail, identity_validator)
    assert manager.last_attempt_count == 2


@pytest.mark.asyncio
async def test_retry_manager_exponential_backoff() -> None:
    """Retry manager uses exponential backoff between retries."""
    config = RetryConfig(max_retries=3, base_delay=1.0, exponential_base=2.0, max_delay=10.0)
    manager = ExtractionRetryManager(config)

    assert manager._calculate_delay(1) == 1.0
    assert manager._calculate_delay(2) == 2.0
    assert manager._calculate_delay(3) == 4.0


@pytest.mark.asyncio
async def test_retry_manager_respects_max_delay() -> None:
    """Retry manager caps delay at max_delay."""
    config = RetryConfig(max_retries=10, base_delay=1.0, exponential_base=2.0, max_delay=5.0)
    manager = ExtractionRetryManager(config)

    assert manager._calculate_delay(1) == 1.0
    assert manager._calculate_delay(2) == 2.0
    assert manager._calculate_delay(3) == 4.0
    assert manager._calculate_delay(4) == 5.0  # capped
    assert manager._calculate_delay(5) == 5.0  # still capped


# --- ExtractionModelRegistry tests ---


def test_model_registry_default_returns_single_model() -> None:
    """Default registry returns a single model with is_default=True."""
    registry = ExtractionModelRegistry.default("openai/gpt-4o")

    config = registry.select_model()
    assert config.model_id == "openai/gpt-4o"
    assert config.is_default is True


def test_model_registry_select_returns_default_when_ab_disabled() -> None:
    """Registry returns default model when A/B testing is disabled."""
    configs = [
        ExtractionModelConfig(name="a", model_id="model-a", weight=1.0, is_default=True),
        ExtractionModelConfig(name="b", model_id="model-b", weight=1.0),
    ]
    registry = ExtractionModelRegistry(configs=configs, ab_test_enabled=False)

    for _ in range(20):
        config = registry.select_model()
        assert config.model_id == "model-a"


def test_model_registry_select_uses_weights_when_ab_enabled() -> None:
    """Registry performs weighted selection when A/B testing is enabled."""
    configs = [
        ExtractionModelConfig(name="a", model_id="model-a", weight=100.0, is_default=True),
        ExtractionModelConfig(name="b", model_id="model-b", weight=0.01),
    ]
    registry = ExtractionModelRegistry(configs=configs, ab_test_enabled=True)

    # With 100:0.01 ratio, almost all selections should be model-a
    selections = [registry.select_model().model_id for _ in range(100)]
    assert selections.count("model-a") > 90


def test_model_registry_get_config_by_name() -> None:
    """Registry can look up configs by name."""
    configs = [
        ExtractionModelConfig(name="fast", model_id="gpt-4o-mini", is_default=True),
        ExtractionModelConfig(name="accurate", model_id="gpt-4o"),
    ]
    registry = ExtractionModelRegistry(configs=configs)

    assert registry.get_config_by_name("accurate") is not None
    assert registry.get_config_by_name("accurate").model_id == "gpt-4o"
    assert registry.get_config_by_name("nonexistent") is None


def test_model_registry_raises_on_empty_configs() -> None:
    """Registry raises ValueError when no models are configured."""
    registry = ExtractionModelRegistry(configs=[], ab_test_enabled=True)

    with pytest.raises(ValueError, match="No extraction models configured"):
        registry.select_model()


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
