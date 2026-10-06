import asyncio
import json
import logging
from dataclasses import dataclass
from datetime import date
from unittest.mock import patch

import httpx
import openai
import pytest

from app.core.errors import ConfigurationError, InvalidConfigurationError
from app.core.settings import Settings
from app.prompts.extraction_prompts import ExtractionPromptManager
from app.services.extraction import (
    ExtractionProviderAccountError,
    ExtractionRequest,
    ExtractionServiceError,
    ExtractorMalformedResponseError,
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
from app.services.transcription import (
    AssemblyAITranscriptionService,
    TranscriptionResult,
    TranscriptionServiceError,
)


class FakeAsyncClient:
    def __init__(self, *, response=None, error: Exception | None = None) -> None:
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
    json_value: object | None = None
    json_error: Exception | None = None

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
            "ASSEMBLYAI_API_KEY": "assemblyai-key",
            "ASSEMBLYAI_POLL_INTERVAL_SECONDS": 0.001,
            "OPENROUTER_API_KEY": "openrouter-key",
            "RESEND_API_KEY": "resend-key",
            "RESEND_FROM_EMAIL": "gust@example.com",
            "RUN_STARTUP_CHECKS": False,
            "SESSION_COOKIE_SECURE": False,
        }
    )


def _assemblyai_service(
    handler,
    **setting_overrides: object,
) -> AssemblyAITranscriptionService:
    settings = build_settings()
    for key, value in setting_overrides.items():
        setattr(settings, key, value)
    return AssemblyAITranscriptionService(settings, transport=httpx.MockTransport(handler))


def _transcribe(service: AssemblyAITranscriptionService) -> TranscriptionResult:
    return asyncio.run(
        service.transcribe(
            audio_bytes=b"voice-bytes",
            filename="capture.webm",
            content_type="audio/webm",
        )
    )


def _assemblyai_handler(
    *,
    upload: httpx.Response | None = None,
    submit: httpx.Response | None = None,
    polls: list[httpx.Response | Exception] | None = None,
    delete: httpx.Response | None = None,
    requests: list[httpx.Request] | None = None,
):
    poll_responses = list(polls or [])

    def handler(request: httpx.Request) -> httpx.Response:
        if requests is not None:
            requests.append(request)
        if request.method == "DELETE":
            assert request.url.path == "/v2/transcript/tx-1"
            return delete or httpx.Response(200, json={"id": "tx-1", "status": "deleted"})
        if request.url.path == "/v2/upload":
            return upload or httpx.Response(200, json={"upload_url": "https://cdn.test/a"})
        if request.url.path == "/v2/transcript":
            return submit or httpx.Response(200, json={"id": "tx-1", "status": "queued"})
        if request.url.path == "/v2/transcript/tx-1":
            poll = poll_responses.pop(0) if len(poll_responses) > 1 else poll_responses[0]
            if isinstance(poll, Exception):
                raise poll
            return poll
        raise AssertionError(f"unexpected request {request.url}")

    return handler


def test_assemblyai_transcribes_via_upload_submit_and_poll() -> None:
    requests: list[httpx.Request] = []
    service = _assemblyai_service(
        _assemblyai_handler(
            polls=[
                httpx.Response(200, json={"id": "tx-1", "status": "processing"}),
                httpx.Response(
                    200, json={"id": "tx-1", "status": "completed", "text": " Buy coffee "}
                ),
            ],
            requests=requests,
        )
    )

    result = _transcribe(service)

    assert result.transcript_text == "Buy coffee"
    assert result.provider == "assemblyai"
    assert [(request.method, request.url.path) for request in requests] == [
        ("POST", "/v2/upload"),
        ("POST", "/v2/transcript"),
        ("GET", "/v2/transcript/tx-1"),
        ("GET", "/v2/transcript/tx-1"),
        ("DELETE", "/v2/transcript/tx-1"),
    ]
    assert all(request.headers["authorization"] == "assemblyai-key" for request in requests)
    assert requests[0].content == b"voice-bytes"
    assert json.loads(requests[1].content) == {
        "audio_url": "https://cdn.test/a",
        "speech_models": ["universal-3-5-pro", "universal-2"],
    }


def test_assemblyai_deletes_transcript_after_a_transcript_error() -> None:
    requests: list[httpx.Request] = []
    service = _assemblyai_service(
        _assemblyai_handler(
            polls=[
                httpx.Response(
                    200,
                    json={"id": "tx-1", "status": "error", "error": "Transcoding failed."},
                )
            ],
            requests=requests,
        )
    )

    with pytest.raises(TranscriptionServiceError):
        _transcribe(service)

    assert requests[-1].method == "DELETE"


def test_assemblyai_cleanup_failure_is_logged_without_failing_transcription(
    caplog: pytest.LogCaptureFixture,
) -> None:
    service = _assemblyai_service(
        _assemblyai_handler(
            polls=[httpx.Response(200, json={"id": "tx-1", "status": "completed", "text": "Hi"})],
            delete=httpx.Response(500, json={"error": "internal"}),
        )
    )

    with caplog.at_level(logging.WARNING, logger="gust.api"):
        result = _transcribe(service)

    assert result.transcript_text == "Hi"
    cleanup_logs = [
        record for record in caplog.records if record.msg == "transcription_provider_cleanup_failed"
    ]
    assert len(cleanup_logs) == 1
    assert cleanup_logs[0].provider_status_code == 500


def test_assemblyai_negative_balance_maps_to_quota_exceeded(
    caplog: pytest.LogCaptureFixture,
) -> None:
    service = _assemblyai_service(
        _assemblyai_handler(
            upload=httpx.Response(
                400,
                json={
                    "error": (
                        "Your current account balance is negative. "
                        "Please top up to continue using the API."
                    )
                },
            )
        )
    )

    with (
        caplog.at_level(logging.WARNING, logger="gust.api"),
        pytest.raises(TranscriptionServiceError) as exc_info,
    ):
        _transcribe(service)

    assert exc_info.value.failure_reason == "quota_exceeded"
    assert exc_info.value.provider_status_code == 400
    assert "assemblyai-key" not in caplog.text
    assert "capture.webm" not in caplog.text


def test_assemblyai_payment_required_maps_to_quota_exceeded() -> None:
    service = _assemblyai_service(
        _assemblyai_handler(submit=httpx.Response(402, json={"error": "Payment required"}))
    )

    with pytest.raises(TranscriptionServiceError) as exc_info:
        _transcribe(service)

    assert exc_info.value.failure_reason == "quota_exceeded"


def test_assemblyai_rejected_credentials_map_to_invalid_configuration() -> None:
    service = _assemblyai_service(
        _assemblyai_handler(
            upload=httpx.Response(
                401, json={"error": "Authentication error, API token missing/invalid."}
            )
        )
    )

    with pytest.raises(InvalidConfigurationError) as exc_info:
        _transcribe(service)

    assert "contact the administrator" in exc_info.value.message


def test_assemblyai_rate_limit_and_server_errors_map_to_provider_unavailable() -> None:
    for status_code in (429, 503):
        service = _assemblyai_service(
            _assemblyai_handler(submit=httpx.Response(status_code, json={"error": "busy"}))
        )
        with pytest.raises(TranscriptionServiceError) as exc_info:
            _transcribe(service)
        assert exc_info.value.failure_reason == "provider_unavailable"


def test_assemblyai_no_spoken_audio_error_maps_to_no_speech() -> None:
    service = _assemblyai_service(
        _assemblyai_handler(
            polls=[
                httpx.Response(
                    200,
                    json={
                        "id": "tx-1",
                        "status": "error",
                        "error": (
                            "language_detection cannot be performed on files with no spoken audio."
                        ),
                    },
                )
            ]
        )
    )

    with pytest.raises(TranscriptionServiceError) as exc_info:
        _transcribe(service)

    assert exc_info.value.failure_reason == "no_speech"


def test_assemblyai_other_transcript_error_maps_to_provider_rejected() -> None:
    service = _assemblyai_service(
        _assemblyai_handler(
            polls=[
                httpx.Response(
                    200,
                    json={"id": "tx-1", "status": "error", "error": "Transcoding failed."},
                )
            ]
        )
    )

    with pytest.raises(TranscriptionServiceError) as exc_info:
        _transcribe(service)

    assert exc_info.value.failure_reason == "provider_rejected"


def test_assemblyai_empty_transcript_maps_to_no_speech() -> None:
    service = _assemblyai_service(
        _assemblyai_handler(
            polls=[httpx.Response(200, json={"id": "tx-1", "status": "completed", "text": "  "})]
        )
    )

    with pytest.raises(TranscriptionServiceError) as exc_info:
        _transcribe(service)

    assert exc_info.value.failure_reason == "no_speech"


def test_assemblyai_polling_is_bounded_by_transcription_timeout() -> None:
    service = _assemblyai_service(
        _assemblyai_handler(
            polls=[httpx.Response(200, json={"id": "tx-1", "status": "processing"})]
        ),
        transcription_timeout_seconds=0.05,
        assemblyai_poll_interval_seconds=0.01,
    )

    with pytest.raises(TranscriptionServiceError) as exc_info:
        _transcribe(service)

    assert exc_info.value.failure_reason == "timeout"


def test_assemblyai_transport_failure_maps_to_provider_unavailable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    with pytest.raises(TranscriptionServiceError) as exc_info:
        _transcribe(_assemblyai_service(handler))

    assert exc_info.value.failure_reason == "provider_unavailable"


def test_assemblyai_invalid_json_maps_to_provider_invalid_response() -> None:
    service = _assemblyai_service(
        _assemblyai_handler(upload=httpx.Response(200, content=b"not json"))
    )

    with pytest.raises(TranscriptionServiceError) as exc_info:
        _transcribe(service)

    assert exc_info.value.failure_reason == "provider_invalid_response"


def test_assemblyai_missing_api_key_fails_closed() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("no provider call expected without credentials")

    with pytest.raises(ConfigurationError):
        _transcribe(_assemblyai_service(handler, assemblyai_api_key=None))


def test_extraction_payment_required_is_not_retried() -> None:
    """Exhausted provider credits should fail fast instead of burning retries."""
    service = LangChainExtractionService(settings=build_settings())
    call_count = 0

    async def no_credits(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        raise ExtractionProviderAccountError(
            "no credits", failure_reason="quota_exceeded", provider_status_code=402
        )

    with (
        patch.object(service, "_execute_extraction", side_effect=no_credits),
        pytest.raises(ExtractionProviderAccountError) as exc_info,
    ):
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

    assert exc_info.value.failure_reason == "quota_exceeded"
    assert call_count == 1
    assert service.last_attempt_count == 1


@pytest.mark.parametrize(
    ("status_code", "expected_reason"),
    [(402, "quota_exceeded"), (401, "credentials_invalid")],
)
def test_extraction_classifies_provider_account_failures(
    monkeypatch: pytest.MonkeyPatch,
    status_code: int,
    expected_reason: str,
) -> None:
    service = LangChainExtractionService(settings=build_settings())
    provider_error = openai.APIStatusError(
        "provider account error",
        response=httpx.Response(
            status_code,
            request=httpx.Request("POST", "https://openrouter.ai/api/v1/chat/completions"),
        ),
        body=None,
    )

    class FailingChain:
        def __or__(self, other):
            return self

        async def ainvoke(self, payload):
            raise provider_error

    monkeypatch.setattr(
        "app.services.extraction.ChatPromptTemplate.from_messages",
        lambda messages: FailingChain(),
    )

    with pytest.raises(ExtractionProviderAccountError) as exc_info:
        asyncio.run(
            service._execute_extraction(
                request=ExtractionRequest(
                    transcript_text="Plan trip",
                    user_timezone="UTC",
                    current_local_date=date(2026, 3, 22),
                    groups=[],
                ),
                model_config=service.model_registry.select_model(),
                llm=object(),
            )
        )

    assert exc_info.value.failure_reason == expected_reason
    assert exc_info.value.provider_status_code == status_code


def test_extraction_service_chain_error_raises_service_error() -> None:
    """Extraction propagates chain errors as ExtractionServiceError after retries."""
    settings = build_settings()
    registry = ExtractionModelRegistry.default("google/gemini-3-flash-preview")

    service = LangChainExtractionService(
        settings=settings,
        model_registry=registry,
    )

    # Mock the chain to always fail
    async def fail_invoke(*args, **kwargs):
        raise RuntimeError("chain failed")

    with (
        patch.object(service, "_execute_extraction", side_effect=fail_invoke),
        pytest.raises(ExtractionServiceError),
    ):
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
    registry = ExtractionModelRegistry.default("google/gemini-3-flash-preview")

    service = LangChainExtractionService(
        settings=settings,
        model_registry=registry,
    )

    async def return_invalid_json(*args, **kwargs):
        return "not valid json {"

    with (
        patch.object(service, "_execute_extraction", side_effect=return_invalid_json),
        pytest.raises(ExtractionServiceError),
    ):
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

    with (
        patch.object(service, "_create_llm", side_effect=tracking_create_llm),
        patch.object(service, "_execute_extraction", side_effect=mock_execute),
    ):
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

    with (
        caplog.at_level(logging.WARNING, logger="gust.api"),
        pytest.raises(ExtractorMalformedResponseError),
    ):
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
    """Payload validation should reject malformed candidates individually."""
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
            service.send_digest(
                to_email="user@example.com",
                subject="Gust Daily Brief",
                text_body="Digest text",
                html_body="<p>Digest html</p>",
                idempotency_key="digest:daily:user:1:start:2026-03-24:end:2026-03-24",
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
            service.send_digest(
                to_email="user@example.com",
                subject="Gust Daily Brief",
                text_body="Digest text",
                html_body="<p>Digest html</p>",
                idempotency_key="digest:daily:user:1:start:2026-03-24:end:2026-03-24",
            )
        )

    assert exc_info.value.retryable is False


def test_resend_service_returns_provider_message_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = ResendReminderService(build_settings())
    client = FakeAsyncClient(
        response=FakeJsonResponse(status_code=200, json_value={"id": "provider-msg-123"})
    )
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda timeout: client,
    )

    result = asyncio.run(
        service.send_digest(
            to_email="user@example.com",
            subject="Gust Daily Brief",
            text_body="Digest text",
            html_body="<p>Digest html</p>",
            idempotency_key="digest:daily:user:1:start:2026-03-24:end:2026-03-24",
        )
    )

    assert result.provider_message_id == "provider-msg-123"
    request_kwargs = client.post_calls[0]["kwargs"]
    assert request_kwargs["headers"]["Idempotency-Key"] == (
        "digest:daily:user:1:start:2026-03-24:end:2026-03-24"
    )


def test_resend_service_forwards_html_digest_body_without_mutation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = ResendReminderService(build_settings())
    malicious_html = '<p>User supplied:</p><a href="https://evil.test">click me</a>'
    client = FakeAsyncClient(
        response=FakeJsonResponse(status_code=200, json_value={"id": "provider-msg-123"})
    )
    monkeypatch.setattr(httpx, "AsyncClient", lambda timeout: client)

    asyncio.run(
        service.send_digest(
            to_email="user@example.com",
            subject="Gust Daily Brief",
            text_body="Digest text",
            html_body=malicious_html,
            idempotency_key="digest:daily:user:1:start:2026-03-24:end:2026-03-24",
        )
    )

    request_kwargs = client.post_calls[0]["kwargs"]
    assert request_kwargs["json"]["html"] == malicious_html


def _poll_connect_error() -> httpx.ConnectError:
    return httpx.ConnectError(
        "blip", request=httpx.Request("GET", "https://api.assemblyai.com/v2/transcript/tx-1")
    )


def test_assemblyai_poll_rides_out_brief_transient_failures() -> None:
    service = _assemblyai_service(
        _assemblyai_handler(
            polls=[
                httpx.Response(503, json={"error": "busy"}),
                _poll_connect_error(),
                httpx.Response(429, json={"error": "slow down"}),
                httpx.Response(200, json={"id": "tx-1", "status": "completed", "text": "Hi"}),
            ]
        )
    )

    assert _transcribe(service).transcript_text == "Hi"


def test_assemblyai_poll_gives_up_after_repeated_transient_failures() -> None:
    requests: list[httpx.Request] = []
    service = _assemblyai_service(
        _assemblyai_handler(
            polls=[httpx.Response(503, json={"error": "busy"})],
            requests=requests,
        )
    )

    with pytest.raises(TranscriptionServiceError) as exc_info:
        _transcribe(service)

    assert exc_info.value.failure_reason == "provider_unavailable"
    poll_requests = [r for r in requests if r.method == "GET"]
    assert len(poll_requests) == 4
    assert requests[-1].method == "DELETE"


def test_assemblyai_poll_does_not_retry_non_transient_failures() -> None:
    requests: list[httpx.Request] = []
    service = _assemblyai_service(
        _assemblyai_handler(
            polls=[httpx.Response(400, json={"error": "Bad transcript id"})],
            requests=requests,
        )
    )

    with pytest.raises(TranscriptionServiceError) as exc_info:
        _transcribe(service)

    assert exc_info.value.failure_reason == "provider_rejected"
    assert len([r for r in requests if r.method == "GET"]) == 1


def test_assemblyai_unrelated_error_text_is_not_treated_as_quota() -> None:
    service = _assemblyai_service(
        _assemblyai_handler(
            upload=httpx.Response(400, json={"error": "Desktop upload of this file type failed"})
        )
    )

    with pytest.raises(TranscriptionServiceError) as exc_info:
        _transcribe(service)

    assert exc_info.value.failure_reason == "provider_rejected"


@pytest.mark.parametrize("status_code", [403, 429, 500])
def test_extraction_does_not_treat_moderation_or_transient_errors_as_account_failures(
    monkeypatch: pytest.MonkeyPatch,
    status_code: int,
) -> None:
    """OpenRouter uses 403 for moderation/guardrail blocks; those are not admin problems."""
    service = LangChainExtractionService(settings=build_settings())
    provider_error = openai.APIStatusError(
        "provider error",
        response=httpx.Response(
            status_code,
            request=httpx.Request("POST", "https://openrouter.ai/api/v1/chat/completions"),
        ),
        body=None,
    )

    class FailingChain:
        def __or__(self, other):
            return self

        async def ainvoke(self, payload):
            raise provider_error

    monkeypatch.setattr(
        "app.services.extraction.ChatPromptTemplate.from_messages",
        lambda messages: FailingChain(),
    )

    with pytest.raises(ExtractorMalformedResponseError) as exc_info:
        asyncio.run(
            service._execute_extraction(
                request=ExtractionRequest(
                    transcript_text="Plan trip",
                    user_timezone="UTC",
                    current_local_date=date(2026, 3, 22),
                    groups=[],
                ),
                model_config=service.model_registry.select_model(),
                llm=object(),
            )
        )

    assert not isinstance(exc_info.value, ExtractionProviderAccountError)
