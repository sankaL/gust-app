from __future__ import annotations

# ruff: noqa: UP045
import asyncio
from contextlib import contextmanager
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any

import pytest
import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient

import app.services.capture as capture_service_module
from app.core.action_locks import ActionLockBusyError, user_action_lock
from app.core.dependencies import (
    get_auth_service,
    get_extraction_service,
    get_transcription_service,
)
from app.core.middleware import RequestContextMiddleware
from app.core.rate_limits import RequestRateLimiter
from app.core.errors import InvalidConfigurationError
from app.core.security import ACCESS_TOKEN_COOKIE
from app.db.engine import connection_scope
from app.db.repositories import ensure_inbox_group, upsert_user
from app.db.schema import captures, extracted_tasks, groups, reminders, subtasks, tasks
from app.services.auth import AuthenticatedIdentity
from app.services.extraction import ExtractorMalformedResponseError
from app.services.staging import ApproveResult, StagingService
from app.services.transcription import TranscriptionResult, TranscriptionServiceError


@dataclass
class FakeAuthService:
    def ensure_configured(self) -> None:
        return None

    def validate_access_token(
        self,
        access_token: str,
        *,
        allow_expired: bool = False,
    ) -> AuthenticatedIdentity:
        del allow_expired
        assert access_token == "access-token"
        return AuthenticatedIdentity(
            user_id="11111111-1111-1111-1111-111111111111",
            email="user@example.com",
            display_name="Gust User",
        )


@dataclass
class FakeTranscriptionService:
    result: TranscriptionResult | None = None
    error: Exception | None = None
    call_count: int = 0

    async def transcribe(
        self,
        *,
        audio_bytes: bytes,
        filename: str,
        content_type: str,
    ) -> TranscriptionResult:
        self.call_count += 1
        assert audio_bytes
        assert filename
        assert content_type
        if self.error is not None:
            raise self.error
        assert self.result is not None
        return self.result


@dataclass
class FakeExtractionService:
    responses: list[Any] = field(default_factory=list)
    call_count: int = 0
    requests: list[Any] = field(default_factory=list)

    async def extract(
        self,
        *,
        request,
        schema: dict[str, object] | None = None,
    ) -> dict[str, object]:
        self.call_count += 1
        self.requests.append(request)
        if schema is not None:
            assert "properties" in schema
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def _override_auth_service(app: FastAPI) -> None:
    app.dependency_overrides[get_auth_service] = lambda: FakeAuthService()


def _override_transcription_service(app: FastAPI, service: FakeTranscriptionService) -> None:
    app.dependency_overrides[get_transcription_service] = lambda: service


def _override_extraction_service(app: FastAPI, service: FakeExtractionService) -> None:
    app.dependency_overrides[get_extraction_service] = lambda: service


async def _fixed_rate_limit_user_id(self, request) -> str:
    del self, request
    return "11111111-1111-1111-1111-111111111111"


def _seed_user(
    client: TestClient,
    *,
    user_id: str = "11111111-1111-1111-1111-111111111111",
) -> None:
    with connection_scope(client.app.state.settings.database_url) as connection:
        upsert_user(
            connection,
            user_id=user_id,
            email="user@example.com",
            display_name="Gust User",
            timezone="UTC",
        )
        ensure_inbox_group(connection, user_id=user_id)


def _seed_group(
    client: TestClient,
    *,
    user_id: str,
    name: str,
    description: str | None = None,
) -> str:
    group_id = str(uuid.uuid4())
    with connection_scope(client.app.state.settings.database_url) as connection:
        connection.execute(
            groups.insert().values(
                id=group_id,
                user_id=user_id,
                name=name,
                description=description,
                is_system=False,
                system_key=None,
            )
        )
    return group_id


def _seed_open_task(
    client: TestClient,
    *,
    user_id: str,
    group_id: str,
    title: str,
    description: str | None = None,
) -> None:
    with connection_scope(client.app.state.settings.database_url) as connection:
        connection.execute(
            tasks.insert().values(
                id=str(uuid.uuid4()),
                user_id=user_id,
                group_id=group_id,
                capture_id=None,
                series_id=None,
                title=title,
                description=description,
                status="open",
                needs_review=False,
            )
        )


def _seed_capture(
    client: TestClient,
    *,
    user_id: str,
    status: str = "ready_for_review",
) -> str:
    capture_id = str(uuid.uuid4())
    with connection_scope(client.app.state.settings.database_url) as connection:
        connection.execute(
            captures.insert().values(
                id=capture_id,
                user_id=user_id,
                input_type="text",
                status=status,
                transcript_text="Plan roadmap",
                expires_at=datetime(2026, 3, 29, tzinfo=timezone.utc),
            )
        )
    return capture_id


def _seed_extracted_task(
    client: TestClient,
    *,
    user_id: str,
    capture_id: str,
    group_id: str,
    description: str | None = None,
    status: str = "pending",
) -> str:
    extracted_task_id = str(uuid.uuid4())
    with connection_scope(client.app.state.settings.database_url) as connection:
        connection.execute(
            extracted_tasks.insert().values(
                id=extracted_task_id,
                user_id=user_id,
                capture_id=capture_id,
                title="Review draft",
                description=description,
                group_id=group_id,
                group_name="Inbox",
                due_date=None,
                reminder_at=None,
                recurrence_frequency=None,
                recurrence_weekday=None,
                recurrence_day_of_month=None,
                top_confidence=0.9,
                needs_review=False,
                status=status,
            )
        )
    return extracted_task_id


def _authenticated_headers(app: FastAPI, client: TestClient) -> dict[str, str]:
    _override_auth_service(app)
    _seed_user(client)
    client.cookies.set(ACCESS_TOKEN_COOKIE, "access-token")
    session_response = client.get("/auth/session")
    csrf_token = session_response.json()["csrf_token"]
    assert csrf_token is not None
    return {"X-CSRF-Token": csrf_token, "Origin": "http://frontend.test"}


def _request_context_middleware(app: FastAPI) -> RequestContextMiddleware:
    current = app.middleware_stack
    while current is not None:
        if isinstance(current, RequestContextMiddleware):
            return current
        current = getattr(current, "app", None)
    raise AssertionError("RequestContextMiddleware not found")


def test_text_capture_requires_csrf(app: FastAPI, client: TestClient) -> None:
    _override_auth_service(app)
    _seed_user(client)
    client.cookies.set(ACCESS_TOKEN_COOKIE, "access-token")

    response = client.post("/captures/text", json={"text": "Plan roadmap"})

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "csrf_invalid"


def test_text_capture_creates_review_ready_capture(app: FastAPI, client: TestClient) -> None:
    headers = _authenticated_headers(app, client)

    response = client.post("/captures/text", json={"text": "Plan roadmap"}, headers=headers)

    assert response.status_code == 201
    payload = response.json()
    assert payload["status"] == "ready_for_review"
    assert payload["transcript_text"] == "Plan roadmap"

    with connection_scope(client.app.state.settings.database_url) as connection:
        capture_row = connection.execute(
            sa.select(captures).where(captures.c.id == payload["capture_id"])
        ).one()

    assert capture_row.input_type == "text"
    assert capture_row.source_text == "Plan roadmap"
    assert capture_row.status == "ready_for_review"


def test_text_capture_rejects_oversized_transcript(app: FastAPI, client: TestClient) -> None:
    headers = _authenticated_headers(app, client)

    response = client.post("/captures/text", json={"text": "a" * 20_001}, headers=headers)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_text_capture_rejects_control_characters(app: FastAPI, client: TestClient) -> None:
    headers = _authenticated_headers(app, client)

    response = client.post("/captures/text", json={"text": "bad\x00input"}, headers=headers)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_text_capture_rate_limit_returns_429(
    app: FastAPI,
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = _authenticated_headers(app, client)
    middleware = _request_context_middleware(app)
    app.state.settings.rate_limit_capture_text_user = "1/60"
    middleware.rate_limiter = RequestRateLimiter(app.state.settings)
    monkeypatch.setattr(
        RequestContextMiddleware,
        "_resolve_rate_limit_user_id",
        _fixed_rate_limit_user_id,
    )

    first = client.post("/captures/text", json={"text": "Plan roadmap"}, headers=headers)
    second = client.post("/captures/text", json={"text": "Plan roadmap"}, headers=headers)

    assert first.status_code == 201
    assert second.status_code == 429
    assert second.json()["error"]["code"] == "rate_limit_exceeded"
    assert second.headers["Retry-After"]


def test_voice_capture_rate_limit_returns_429(
    app: FastAPI,
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = _authenticated_headers(app, client)
    middleware = _request_context_middleware(app)
    app.state.settings.rate_limit_capture_voice_user = "1/60"
    middleware.rate_limiter = RequestRateLimiter(app.state.settings)
    monkeypatch.setattr(
        RequestContextMiddleware,
        "_resolve_rate_limit_user_id",
        _fixed_rate_limit_user_id,
    )
    _override_transcription_service(
        app,
        FakeTranscriptionService(
            result=TranscriptionResult(
                transcript_text="Buy coffee beans at 5pm",
                provider="mistral",
                latency_ms=412,
            )
        ),
    )

    first = client.post(
        "/captures/voice",
        headers=headers,
        files={"audio": ("capture.webm", b"voice-bytes", "audio/webm")},
    )
    second = client.post(
        "/captures/voice",
        headers=headers,
        files={"audio": ("capture.webm", b"voice-bytes", "audio/webm")},
    )

    assert first.status_code == 201
    assert second.status_code == 429
    assert second.json()["error"]["code"] == "rate_limit_exceeded"


def test_voice_capture_rejects_invalid_audio_content_type(app: FastAPI, client: TestClient) -> None:
    headers = _authenticated_headers(app, client)

    response = client.post(
        "/captures/voice",
        headers=headers,
        files={"audio": ("capture.txt", b"voice-bytes", "text/plain")},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_capture"


def test_voice_capture_rejects_oversized_audio_upload(app: FastAPI, client: TestClient) -> None:
    headers = _authenticated_headers(app, client)
    client.app.state.settings.max_audio_upload_bytes = 4

    response = client.post(
        "/captures/voice",
        headers=headers,
        files={"audio": ("capture.webm", b"voice-bytes", "audio/webm")},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_capture"


def test_capture_lock_contention_returns_429(
    app: FastAPI,
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = _authenticated_headers(app, client)

    @contextmanager
    def busy_lock(self, *, user_id: str, action: str):
        del self, user_id, action
        raise ActionLockBusyError()
        yield

    monkeypatch.setattr(capture_service_module.CaptureService, "_capture_lock", busy_lock)

    response = client.post("/captures/text", json={"text": "Plan roadmap"}, headers=headers)

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "rate_limit_exceeded"


def test_user_action_lock_blocks_concurrent_attempts_and_releases(client: TestClient) -> None:
    database_url = client.app.state.settings.database_url

    with user_action_lock(
        database_url=database_url,
        user_id="11111111-1111-1111-1111-111111111111",
        action="capture_voice",
    ):
        with pytest.raises(ActionLockBusyError):
            with user_action_lock(
                database_url=database_url,
                user_id="11111111-1111-1111-1111-111111111111",
                action="capture_voice",
            ):
                pass

    with user_action_lock(
        database_url=database_url,
        user_id="11111111-1111-1111-1111-111111111111",
        action="capture_voice",
    ):
        pass


def test_voice_capture_transcribes_audio_and_returns_review_state(
    app: FastAPI,
    client: TestClient,
) -> None:
    headers = _authenticated_headers(app, client)
    fake_transcription = FakeTranscriptionService(
        result=TranscriptionResult(
            transcript_text="Buy coffee beans at 5pm",
            provider="mistral",
            latency_ms=412,
        )
    )
    _override_transcription_service(app, fake_transcription)

    response = client.post(
        "/captures/voice",
        headers=headers,
        files={"audio": ("capture.webm", b"voice-bytes", "audio/webm")},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["status"] == "ready_for_review"
    assert payload["transcript_text"] == "Buy coffee beans at 5pm"
    assert fake_transcription.call_count == 1

    with connection_scope(client.app.state.settings.database_url) as connection:
        capture_row = connection.execute(
            sa.select(captures).where(captures.c.id == payload["capture_id"])
        ).one()

    assert capture_row.status == "ready_for_review"
    assert capture_row.transcription_provider == "mistral"
    assert capture_row.transcription_latency_ms == 412


def test_voice_capture_marks_capture_failed_on_transcription_error(
    app: FastAPI,
    client: TestClient,
    caplog,
) -> None:
    headers = _authenticated_headers(app, client)
    _override_transcription_service(
        app,
        FakeTranscriptionService(
            error=TranscriptionServiceError(
                "provider down",
                failure_reason="provider_unavailable",
                provider_status_code=503,
                provider_error_type="upstream_unavailable",
                provider_error_code="E503",
            )
        ),
    )

    with caplog.at_level(logging.WARNING, logger="gust.api"):
        response = client.post(
            "/captures/voice",
            headers={**headers, "X-Request-ID": "req-transcription-1"},
            files={"audio": ("capture.webm", b"voice-bytes", "audio/webm")},
        )

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "transcription_provider_unavailable"
    assert response.json()["request_id"] == "req-transcription-1"

    with connection_scope(client.app.state.settings.database_url) as connection:
        capture_row = connection.execute(sa.select(captures)).one()

    assert capture_row.status == "transcription_failed"
    assert capture_row.error_code == "provider_unavailable"

    failure_logs = [
        record for record in caplog.records if record.msg == "voice_transcription_failed"
    ]
    assert len(failure_logs) == 1
    failure_log = failure_logs[0]
    assert failure_log.request_id == "req-transcription-1"
    assert failure_log.capture_id == str(capture_row.id)
    assert failure_log.user_id == "11111111-1111-1111-1111-111111111111"
    assert failure_log.transcription_failure_reason == "provider_unavailable"
    assert failure_log.provider_status_code == 503
    assert failure_log.provider_error_type == "upstream_unavailable"
    assert failure_log.provider_error_code == "E503"
    assert failure_log.audio_filename_extension == "webm"
    assert failure_log.content_type == "audio/webm"
    assert failure_log.audio_size_bytes == len(b"voice-bytes")
    assert "Buy coffee beans at 5pm" not in caplog.text
    assert "capture.webm" not in caplog.text


def test_voice_capture_returns_user_error_for_no_speech(
    app: FastAPI,
    client: TestClient,
) -> None:
    headers = _authenticated_headers(app, client)
    _override_transcription_service(
        app,
        FakeTranscriptionService(
            error=TranscriptionServiceError(
                "no speech",
                failure_reason="no_speech",
            )
        ),
    )

    response = client.post(
        "/captures/voice",
        headers=headers,
        files={"audio": ("capture.webm", b"voice-bytes", "audio/webm")},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "transcription_no_speech"

    with connection_scope(client.app.state.settings.database_url) as connection:
        capture_row = connection.execute(sa.select(captures)).one()

    assert capture_row.status == "transcription_failed"
    assert capture_row.error_code == "no_speech"


def test_voice_capture_returns_timeout_error_for_transcription_timeout(
    app: FastAPI,
    client: TestClient,
) -> None:
    headers = _authenticated_headers(app, client)
    _override_transcription_service(
        app,
        FakeTranscriptionService(
            error=TranscriptionServiceError(
                "timeout",
                failure_reason="timeout",
            )
        ),
    )

    response = client.post(
        "/captures/voice",
        headers=headers,
        files={"audio": ("capture.webm", b"voice-bytes", "audio/webm")},
    )

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "transcription_timeout"

    with connection_scope(client.app.state.settings.database_url) as connection:
        capture_row = connection.execute(sa.select(captures)).one()

    assert capture_row.status == "transcription_failed"
    assert capture_row.error_code == "timeout"


def test_voice_capture_returns_provider_rejected_error(
    app: FastAPI,
    client: TestClient,
) -> None:
    headers = _authenticated_headers(app, client)
    _override_transcription_service(
        app,
        FakeTranscriptionService(
            error=TranscriptionServiceError(
                "rejected",
                failure_reason="provider_rejected",
            )
        ),
    )

    response = client.post(
        "/captures/voice",
        headers=headers,
        files={"audio": ("capture.webm", b"voice-bytes", "audio/webm")},
    )

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "transcription_provider_rejected"

    with connection_scope(client.app.state.settings.database_url) as connection:
        capture_row = connection.execute(sa.select(captures)).one()

    assert capture_row.status == "transcription_failed"
    assert capture_row.error_code == "provider_rejected"


def test_voice_capture_returns_provider_invalid_response_error(
    app: FastAPI,
    client: TestClient,
) -> None:
    headers = _authenticated_headers(app, client)
    _override_transcription_service(
        app,
        FakeTranscriptionService(
            error=TranscriptionServiceError(
                "invalid payload",
                failure_reason="provider_invalid_response",
            )
        ),
    )

    response = client.post(
        "/captures/voice",
        headers=headers,
        files={"audio": ("capture.webm", b"voice-bytes", "audio/webm")},
    )

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "transcription_provider_invalid_response"

    with connection_scope(client.app.state.settings.database_url) as connection:
        capture_row = connection.execute(sa.select(captures)).one()

    assert capture_row.status == "transcription_failed"
    assert capture_row.error_code == "provider_invalid_response"


def test_voice_capture_returns_config_invalid_for_invalid_transcription_model(
    app: FastAPI,
    client: TestClient,
) -> None:
    headers = _authenticated_headers(app, client)
    _override_transcription_service(
        app,
        FakeTranscriptionService(
            error=InvalidConfigurationError("Configured Mistral transcription model is invalid."),
        ),
    )

    response = client.post(
        "/captures/voice",
        headers=headers,
        files={"audio": ("capture.webm", b"voice-bytes", "audio/webm")},
    )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "config_invalid"

    with connection_scope(client.app.state.settings.database_url) as connection:
        capture_row = connection.execute(sa.select(captures)).one()

    assert capture_row.status == "transcription_failed"
    assert capture_row.error_code == "config_invalid"


def test_voice_capture_surfaces_unexpected_transcription_errors_as_internal_error(
    app: FastAPI,
    client: TestClient,
) -> None:
    headers = _authenticated_headers(app, client)
    _override_transcription_service(
        app,
        FakeTranscriptionService(
            error=RuntimeError("unexpected crash"),
        ),
    )

    response = client.post(
        "/captures/voice",
        headers=headers,
        files={"audio": ("capture.webm", b"voice-bytes", "audio/webm")},
    )

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "transcription_failed"

    with connection_scope(client.app.state.settings.database_url) as connection:
        capture_row = connection.execute(sa.select(captures)).one()

    assert capture_row.status == "transcription_failed"
    assert capture_row.error_code == "unknown"


def test_submit_capture_persists_tasks_subtasks_and_digest_only_reminder_fields(
    app: FastAPI,
    client: TestClient,
) -> None:
    headers = _authenticated_headers(app, client)
    user_id = "11111111-1111-1111-1111-111111111111"
    work_group_id = _seed_group(client, user_id=user_id, name="Work", description="Job")
    _seed_open_task(client, user_id=user_id, group_id=work_group_id, title="Existing work task")

    create_response = client.post(
        "/captures/text",
        json={"text": "Draft follow-up and buy groceries"},
        headers=headers,
    )
    capture_id = create_response.json()["capture_id"]

    fake_extraction = FakeExtractionService(
        responses=[
            {
                "tasks": [
                    {
                        "title": "Send invoice",
                        "description": "For the client follow-up after the draft is ready.",
                        "due_date": "2026-03-23",
                        "reminder_at": "2026-03-23T13:00:00Z",
                        "group_name": "Work",
                        "top_confidence": 0.91,
                        "alternative_groups": [{"group_name": "Inbox", "confidence": 0.2}],
                        "subtasks": [{"title": "Draft email"}],
                    },
                    {
                        "title": "Buy groceries",
                        "description": "Pick up food for the house tomorrow.",
                        "due_date": "2026-03-24",
                        "group_name": "Unknown",
                        "top_confidence": 0.65,
                        "alternative_groups": [{"group_name": "Inbox", "confidence": 0.58}],
                    },
                    {
                        "title": "  ",
                        "group_name": "Work",
                        "top_confidence": 0.9,
                    },
                ]
            }
        ]
    )
    _override_extraction_service(app, fake_extraction)

    response = client.post(
        f"/captures/{capture_id}/submit",
        json={"transcript_text": "Draft follow-up and buy groceries tomorrow"},
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["tasks_created_count"] == 2
    assert payload["tasks_flagged_for_review_count"] == 1
    assert payload["tasks_skipped_count"] == 1
    assert payload["zero_actionable"] is False
    assert fake_extraction.call_count == 1
    assert fake_extraction.requests[0].groups[1]["recent_task_titles"] == ["Existing work task"]

    with connection_scope(client.app.state.settings.database_url) as connection:
        task_rows = connection.execute(
            sa.select(tasks).where(tasks.c.capture_id == capture_id).order_by(tasks.c.title)
        ).fetchall()
        reminder_rows = connection.execute(sa.select(reminders)).fetchall()
        subtask_rows = connection.execute(sa.select(subtasks)).fetchall()
        capture_row = connection.execute(
            sa.select(captures).where(captures.c.id == capture_id)
        ).one()
        inbox_group = ensure_inbox_group(connection, user_id=user_id)

    assert [row.title for row in task_rows] == ["Buy groceries", "Send invoice"]
    assert task_rows[0].description == "Pick up food for the house tomorrow."
    assert task_rows[0].group_id == inbox_group.id
    assert task_rows[0].needs_review is True
    assert task_rows[1].description == "For the client follow-up after the draft is ready."
    assert task_rows[1].group_id == work_group_id
    assert task_rows[1].needs_review is False
    assert task_rows[1].reminder_at == datetime(2026, 3, 23, 13, 0)
    assert task_rows[1].reminder_offset_minutes == 780
    assert reminder_rows == []


def test_submit_capture_rate_limit_returns_429(
    app: FastAPI,
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = _authenticated_headers(app, client)
    middleware = _request_context_middleware(app)
    app.state.settings.rate_limit_capture_submit_user = "1/60"
    middleware.rate_limiter = RequestRateLimiter(app.state.settings)
    monkeypatch.setattr(
        RequestContextMiddleware,
        "_resolve_rate_limit_user_id",
        _fixed_rate_limit_user_id,
    )
    capture_id = _seed_capture(client, user_id="11111111-1111-1111-1111-111111111111")
    _override_extraction_service(
        app,
        FakeExtractionService(
            responses=[
                {"tasks": [{"title": "Review roadmap", "top_confidence": 0.9, "subtasks": []}]}
            ]
        ),
    )

    first = client.post(
        f"/captures/{capture_id}/submit",
        json={"transcript_text": "Review roadmap"},
        headers=headers,
    )
    second = client.post(
        f"/captures/{capture_id}/submit",
        json={"transcript_text": "Review roadmap"},
        headers=headers,
    )

    assert first.status_code == 200
    assert second.status_code == 429
    assert second.json()["error"]["code"] == "rate_limit_exceeded"


def test_submit_capture_can_retry_after_downstream_write_failure(
    app: FastAPI,
    client: TestClient,
    monkeypatch,
) -> None:
    headers = _authenticated_headers(app, client)
    create_response = client.post(
        "/captures/text",
        json={"text": "Plan trip"},
        headers=headers,
    )
    capture_id = create_response.json()["capture_id"]

    fake_extraction = FakeExtractionService(
        responses=[
            {"tasks": [{"title": "Plan trip", "group_name": "Inbox", "top_confidence": 0.9}]},
            {"tasks": [{"title": "Plan trip", "group_name": "Inbox", "top_confidence": 0.9}]},
        ]
    )
    _override_extraction_service(app, fake_extraction)

    real_create_task = capture_service_module.create_task
    create_task_calls = 0

    def flaky_create_task(*args, **kwargs):
        nonlocal create_task_calls
        create_task_calls += 1
        if create_task_calls == 1:
            raise RuntimeError("database write failed")
        return real_create_task(*args, **kwargs)

    monkeypatch.setattr(capture_service_module, "create_task", flaky_create_task)

    with TestClient(app, follow_redirects=False, raise_server_exceptions=False) as failing_client:
        _override_auth_service(app)
        failing_client.cookies.set(ACCESS_TOKEN_COOKIE, "access-token")
        session_response = failing_client.get("/auth/session")
        csrf_token = session_response.json()["csrf_token"]
        assert csrf_token is not None

        first_response = failing_client.post(
            f"/captures/{capture_id}/submit",
            json={"transcript_text": "Plan trip next week"},
            headers={"X-CSRF-Token": csrf_token, "Origin": "http://frontend.test"},
        )

    assert first_response.status_code == 500
    assert first_response.json()["error"]["code"] == "internal_error"

    with connection_scope(client.app.state.settings.database_url) as connection:
        capture_row = connection.execute(
            sa.select(captures).where(captures.c.id == capture_id)
        ).one()
        task_rows = connection.execute(
            sa.select(tasks).where(tasks.c.capture_id == capture_id)
        ).fetchall()

    assert capture_row.status == "ready_for_review"
    assert task_rows == []

    second_response = client.post(
        f"/captures/{capture_id}/submit",
        json={"transcript_text": "Plan trip next week"},
        headers=headers,
    )

    assert second_response.status_code == 200
    assert second_response.json()["tasks_created_count"] == 1

    with connection_scope(client.app.state.settings.database_url) as connection:
        final_capture_row = connection.execute(
            sa.select(captures).where(captures.c.id == capture_id)
        ).one()

    assert final_capture_row.status == "completed"


def test_submit_capture_retries_once_on_malformed_full_payload(
    app: FastAPI,
    client: TestClient,
) -> None:
    headers = _authenticated_headers(app, client)
    work_group_id = _seed_group(
        client,
        user_id="11111111-1111-1111-1111-111111111111",
        name="Work",
    )
    del work_group_id

    create_response = client.post(
        "/captures/text",
        json={"text": "Plan trip"},
        headers=headers,
    )
    capture_id = create_response.json()["capture_id"]

    fake_extraction = FakeExtractionService(
        responses=[
            {"unexpected": []},
            {"tasks": [{"title": "Plan trip", "group_name": "Work", "top_confidence": 0.9}]},
        ]
    )
    _override_extraction_service(app, fake_extraction)

    response = client.post(
        f"/captures/{capture_id}/submit",
        json={"transcript_text": "Plan trip next week"},
        headers=headers,
    )

    assert response.status_code == 200
    assert fake_extraction.call_count == 2

    with connection_scope(client.app.state.settings.database_url) as connection:
        capture_row = connection.execute(
            sa.select(captures).where(captures.c.id == capture_id)
        ).one()

    assert capture_row.extraction_attempt_count == 2
    assert capture_row.status == "completed"


def test_submit_capture_fails_after_second_malformed_full_payload(
    app: FastAPI,
    client: TestClient,
) -> None:
    headers = _authenticated_headers(app, client)
    create_response = client.post(
        "/captures/text",
        json={"text": "Plan trip"},
        headers=headers,
    )
    capture_id = create_response.json()["capture_id"]
    _override_extraction_service(
        app,
        FakeExtractionService(
            responses=[
                ExtractorMalformedResponseError("bad payload"),
                {"unexpected": []},
            ]
        ),
    )

    response = client.post(
        f"/captures/{capture_id}/submit",
        json={"transcript_text": "Plan trip next week"},
        headers=headers,
    )

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "extraction_failed"

    with connection_scope(client.app.state.settings.database_url) as connection:
        capture_row = connection.execute(
            sa.select(captures).where(captures.c.id == capture_id)
        ).one()
        task_rows = connection.execute(sa.select(tasks)).fetchall()

    assert capture_row.status == "extraction_failed"
    assert capture_row.extraction_attempt_count == 2
    assert task_rows == []


def test_submit_capture_returns_zero_actionable_when_all_items_are_skipped(
    app: FastAPI,
    client: TestClient,
) -> None:
    headers = _authenticated_headers(app, client)
    create_response = client.post(
        "/captures/text",
        json={"text": "Call Sam"},
        headers=headers,
    )
    capture_id = create_response.json()["capture_id"]
    _override_extraction_service(
        app,
        FakeExtractionService(
            responses=[
                {
                    "tasks": [
                        {
                            "title": "Call Sam",
                            "reminder_at": "2026-03-23T09:00:00Z",
                            "group_name": "Inbox",
                            "top_confidence": 0.4,
                        }
                    ]
                }
            ]
        ),
    )

    response = client.post(
        f"/captures/{capture_id}/submit",
        json={"transcript_text": "Call Sam"},
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["tasks_created_count"] == 0
    assert payload["tasks_skipped_count"] == 1
    assert payload["zero_actionable"] is True


def test_submit_capture_repairs_missing_guarded_intent_with_second_extraction(
    app: FastAPI,
    client: TestClient,
) -> None:
    headers = _authenticated_headers(app, client)
    user_id = "11111111-1111-1111-1111-111111111111"
    work_group_id = _seed_group(client, user_id=user_id, name="Work", description="Job")
    transcript = (
        "So I need to create a resume for AI product manager and start applying to some jobs "
        "using it to do that. I need to fix up my resume, do some research on what skills they "
        "should have and maybe upskill my skills too. And also I should uh I gotta call my "
        "dentist to probably tomorrow. Um around 9 a.m. to fix my metal thing in my mouth. Yeah."
    )

    create_response = client.post("/captures/text", json={"text": transcript}, headers=headers)
    capture_id = create_response.json()["capture_id"]
    fake_extraction = FakeExtractionService(
        responses=[
            {
                "tasks": [
                    {
                        "title": "Create resume for AI product manager",
                        "group_name": "Work",
                        "top_confidence": 0.9,
                    },
                    {
                        "title": "Apply to AI product manager jobs",
                        "group_name": "Work",
                        "top_confidence": 0.9,
                    },
                ]
            },
            {
                "tasks": [
                    {
                        "title": "Create resume for AI product manager",
                        "group_name": "Work",
                        "top_confidence": 0.9,
                    },
                    {
                        "title": "Apply to AI product manager jobs",
                        "group_name": "Work",
                        "top_confidence": 0.9,
                    },
                    {
                        "title": "Call dentist tomorrow at 9am about metal thing in mouth",
                        "group_name": "Inbox",
                        "top_confidence": 0.92,
                    },
                ]
            },
        ]
    )
    _override_extraction_service(app, fake_extraction)

    response = client.post(
        f"/captures/{capture_id}/submit",
        json={"transcript_text": transcript},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["tasks_created_count"] == 3
    assert fake_extraction.call_count == 2
    assert fake_extraction.requests[1].missing_guarded_clauses is not None
    assert "call my dentist" in fake_extraction.requests[1].missing_guarded_clauses[0].lower()

    with connection_scope(client.app.state.settings.database_url) as connection:
        task_rows = connection.execute(
            sa.select(tasks).where(tasks.c.capture_id == capture_id).order_by(tasks.c.title)
        ).fetchall()

    assert [row.title for row in task_rows] == [
        "Apply to AI product manager jobs",
        "Call dentist tomorrow at 9am about metal thing in mouth",
        "Create resume for AI product manager",
    ]
    assert task_rows[0].group_id == work_group_id


def test_submit_capture_creates_fallback_review_task_when_guarded_intent_still_missing(
    app: FastAPI,
    client: TestClient,
) -> None:
    headers = _authenticated_headers(app, client)
    user_id = "11111111-1111-1111-1111-111111111111"
    _seed_group(client, user_id=user_id, name="Work", description="Job")
    transcript = (
        "So I need to create a resume for AI product manager and start applying to some jobs "
        "using it to do that. I need to fix up my resume, do some research on what skills they "
        "should have and maybe upskill my skills too. And also I should uh I gotta call my "
        "dentist to probably tomorrow. Um around 9 a.m. to fix my metal thing in my mouth. Yeah."
    )

    create_response = client.post("/captures/text", json={"text": transcript}, headers=headers)
    capture_id = create_response.json()["capture_id"]
    fake_extraction = FakeExtractionService(
        responses=[
            {
                "tasks": [
                    {
                        "title": "Create resume for AI product manager",
                        "group_name": "Work",
                        "top_confidence": 0.9,
                    },
                    {
                        "title": "Apply to AI product manager jobs",
                        "group_name": "Work",
                        "top_confidence": 0.9,
                    },
                ]
            },
            {
                "tasks": [
                    {
                        "title": "Create resume for AI product manager",
                        "group_name": "Work",
                        "top_confidence": 0.9,
                    },
                    {
                        "title": "Apply to AI product manager jobs",
                        "group_name": "Work",
                        "top_confidence": 0.9,
                    },
                ]
            },
        ]
    )
    _override_extraction_service(app, fake_extraction)

    response = client.post(
        f"/captures/{capture_id}/submit",
        json={"transcript_text": transcript},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["tasks_created_count"] == 3
    assert response.json()["tasks_flagged_for_review_count"] == 1
    assert fake_extraction.call_count == 2

    with connection_scope(client.app.state.settings.database_url) as connection:
        task_rows = connection.execute(
            sa.select(tasks)
            .where(tasks.c.capture_id == capture_id)
            .order_by(tasks.c.created_at.asc())
        ).fetchall()
        inbox_group = ensure_inbox_group(connection, user_id=user_id)

    fallback_task = next(row for row in task_rows if "call my dentist" in row.title.lower())
    assert fallback_task.group_id == inbox_group.id
    assert fallback_task.needs_review is True
    assert fallback_task.title == (
        "Call my dentist to probably tomorrow around 9 a.m to fix my metal thing in my mouth"
    )


def test_submit_capture_is_scoped_to_the_authenticated_user(
    app: FastAPI,
    client: TestClient,
) -> None:
    headers = _authenticated_headers(app, client)
    other_user_id = "22222222-2222-2222-2222-222222222222"
    with connection_scope(client.app.state.settings.database_url) as connection:
        upsert_user(
            connection,
            user_id=other_user_id,
            email="other@example.com",
            display_name="Other User",
            timezone="UTC",
        )
        ensure_inbox_group(connection, user_id=other_user_id)
        connection.execute(
            captures.insert().values(
                id="33333333-3333-3333-3333-333333333333",
                user_id=other_user_id,
                input_type="text",
                status="ready_for_review",
                transcript_text="Secret task",
                expires_at=datetime(2026, 3, 29, tzinfo=timezone.utc),
            )
        )

    response = client.post(
        "/captures/33333333-3333-3333-3333-333333333333/submit",
        json={"transcript_text": "Secret task"},
        headers=headers,
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "capture_not_found"


def test_list_extracted_tasks_allows_authenticated_get_without_csrf(
    app: FastAPI,
    client: TestClient,
) -> None:
    _override_auth_service(app)
    _seed_user(client)
    user_id = "11111111-1111-1111-1111-111111111111"
    client.cookies.set(ACCESS_TOKEN_COOKIE, "access-token")

    capture_id = _seed_capture(client, user_id=user_id)
    with connection_scope(client.app.state.settings.database_url) as connection:
        inbox_group = ensure_inbox_group(connection, user_id=user_id)
    _seed_extracted_task(
        client,
        user_id=user_id,
        capture_id=capture_id,
        group_id=inbox_group.id,
        status="pending",
    )

    response = client.get(f"/captures/{capture_id}/extracted-tasks")

    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["status"] == "pending"
    assert payload[0]["description"] is None


def test_approve_extracted_task_returns_not_found_for_unknown_row(
    app: FastAPI,
    client: TestClient,
) -> None:
    headers = _authenticated_headers(app, client)
    user_id = "11111111-1111-1111-1111-111111111111"
    capture_id = _seed_capture(client, user_id=user_id)

    response = client.post(
        f"/captures/{capture_id}/extracted-tasks/{uuid.uuid4()}/approve",
        headers=headers,
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "extracted_task_not_found"


def test_approve_all_continues_after_an_item_failure(client: TestClient) -> None:
    user_id = "11111111-1111-1111-1111-111111111111"
    _seed_user(client, user_id=user_id)
    capture_id = _seed_capture(client, user_id=user_id)
    with connection_scope(client.app.state.settings.database_url) as connection:
        inbox_group = ensure_inbox_group(connection, user_id=user_id)

    first_extracted_task_id = _seed_extracted_task(
        client,
        user_id=user_id,
        capture_id=capture_id,
        group_id=inbox_group.id,
        status="pending",
    )
    second_extracted_task_id = _seed_extracted_task(
        client,
        user_id=user_id,
        capture_id=capture_id,
        group_id=inbox_group.id,
        status="pending",
    )

    service = StagingService(settings=client.app.state.settings)
    attempted_ids: list[str] = []

    async def fake_approve_task(*, user_id: str, capture_id: str, extracted_task_id: str):
        attempted_ids.append(extracted_task_id)
        if extracted_task_id == first_extracted_task_id:
            raise RuntimeError("boom")
        return ApproveResult(
            task=SimpleNamespace(id="task-1"),
            extracted_task_id=extracted_task_id,
        )

    service.approve_task = fake_approve_task  # type: ignore[method-assign]

    results = asyncio.run(service.approve_all(user_id=user_id, capture_id=capture_id))

    assert set(attempted_ids) == {first_extracted_task_id, second_extracted_task_id}
    assert len(attempted_ids) == 2
    assert [result.extracted_task_id for result in results] == [second_extracted_task_id]


def test_complete_capture_conflicts_when_pending_extracted_tasks_exist(
    app: FastAPI,
    client: TestClient,
) -> None:
    headers = _authenticated_headers(app, client)
    user_id = "11111111-1111-1111-1111-111111111111"
    capture_id = _seed_capture(client, user_id=user_id)
    with connection_scope(client.app.state.settings.database_url) as connection:
        inbox_group = ensure_inbox_group(connection, user_id=user_id)
    _seed_extracted_task(
        client,
        user_id=user_id,
        capture_id=capture_id,
        group_id=inbox_group.id,
        status="pending",
    )

    response = client.post(f"/captures/{capture_id}/complete", headers=headers)

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "capture_state_conflict"


def test_re_extract_replaces_existing_staged_tasks_for_capture(
    app: FastAPI,
    client: TestClient,
) -> None:
    headers = _authenticated_headers(app, client)
    user_id = "11111111-1111-1111-1111-111111111111"
    capture_id = _seed_capture(client, user_id=user_id)
    with connection_scope(client.app.state.settings.database_url) as connection:
        inbox_group = ensure_inbox_group(connection, user_id=user_id)
    _seed_extracted_task(
        client,
        user_id=user_id,
        capture_id=capture_id,
        group_id=inbox_group.id,
        status="pending",
    )
    _override_extraction_service(
        app,
        FakeExtractionService(
            responses=[
                {
                    "tasks": [
                        {
                            "title": "New extracted task",
                            "group_name": "Inbox",
                            "top_confidence": 0.92,
                        }
                    ]
                }
            ]
        ),
    )

    response = client.post(
        f"/captures/{capture_id}/re-extract",
        json={"transcript_text": "New transcript text"},
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["title"] == "New extracted task"

    with connection_scope(client.app.state.settings.database_url) as connection:
        rows = connection.execute(
            sa.select(extracted_tasks).where(extracted_tasks.c.capture_id == capture_id)
        ).fetchall()

    assert len(rows) == 1
    assert rows[0].title == "New extracted task"


def test_approve_extracted_task_copies_description_to_saved_task(
    app: FastAPI,
    client: TestClient,
) -> None:
    headers = _authenticated_headers(app, client)
    user_id = "11111111-1111-1111-1111-111111111111"
    capture_id = _seed_capture(client, user_id=user_id)
    with connection_scope(client.app.state.settings.database_url) as connection:
        inbox_group = ensure_inbox_group(connection, user_id=user_id)
    extracted_task_id = _seed_extracted_task(
        client,
        user_id=user_id,
        capture_id=capture_id,
        group_id=inbox_group.id,
        description="Follow up with a short summary after reviewing the draft.",
        status="pending",
    )

    response = client.post(
        f"/captures/{capture_id}/extracted-tasks/{extracted_task_id}/approve",
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["description"] == "Follow up with a short summary after reviewing the draft."

    with connection_scope(client.app.state.settings.database_url) as connection:
        task_row = connection.execute(
            sa.select(tasks).where(tasks.c.capture_id == capture_id)
        ).one()

    assert task_row.description == "Follow up with a short summary after reviewing the draft."
