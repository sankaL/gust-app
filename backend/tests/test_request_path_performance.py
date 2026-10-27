"""Request-path performance guarantees.

Covers full-request timing, one auth service per process, and blocking work kept off the
event loop. The responsiveness tests block one request on purpose and check that an
unrelated request still answers quickly; a stalled event loop would make it wait.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import FastAPI
from starlette.testclient import TestClient

import app.core.action_locks as action_locks_module
import app.core.dependencies as dependencies_module
import app.services.auth as auth_module
import app.services.staging as staging_module
from app.core.action_locks import user_action_lock
from app.core.dependencies import get_auth_service, get_reminder_worker_service
from app.core.middleware import RequestContextMiddleware
from app.core.rate_limits import RequestRateLimiter
from app.core.security import ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, TokenBundle
from app.db.engine import connection_scope
from app.db.repositories import ensure_inbox_group, upsert_user
from app.services.auth import AuthenticatedIdentity, AuthenticatedSession
from app.services.reminders import INTERNAL_JOB_SECRET_HEADER, ReminderRunSummary

USER_ID = "11111111-1111-1111-1111-111111111111"
# The deliberately blocked request holds its call this long; the unrelated request must answer
# well inside it, or the event loop was stalled.
BLOCKING_SECONDS = 1.0
RESPONSIVE_SECONDS = 0.5


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
            user_id=USER_ID,
            email="user@example.com",
            display_name="Gust User",
        )


def _middleware(app: FastAPI) -> RequestContextMiddleware:
    current = app.middleware_stack
    while current is not None:
        if isinstance(current, RequestContextMiddleware):
            return current
        current = getattr(current, "app", None)
    raise AssertionError("RequestContextMiddleware not found")


def _sign_in_with_fake_auth(app: FastAPI, client: TestClient) -> None:
    app.dependency_overrides[get_auth_service] = lambda: FakeAuthService()
    _middleware(app).auth_service = FakeAuthService()
    with connection_scope(client.app.state.settings.database_url) as connection:
        upsert_user(
            connection,
            user_id=USER_ID,
            email="user@example.com",
            display_name="Gust User",
            timezone="UTC",
        )
        ensure_inbox_group(connection, user_id=USER_ID)
    client.cookies.set(ACCESS_TOKEN_COOKIE, "access-token")


def _server_timing(response: httpx.Response) -> dict[str, float]:
    stages: dict[str, float] = {}
    for entry in response.headers.get("Server-Timing", "").split(","):
        name, _, duration = entry.strip().partition(";dur=")
        if name:
            stages[name] = float(duration)
    return stages


def _slowed[**P, R](func: Callable[P, R], entered: threading.Event) -> Callable[P, R]:
    def slow(*args: P.args, **kwargs: P.kwargs) -> R:
        entered.set()
        time.sleep(BLOCKING_SECONDS)
        return func(*args, **kwargs)

    return slow


def _health_latency_while(
    client: TestClient,
    slow_request: Callable[[], httpx.Response],
    entered: threading.Event,
) -> float:
    slow_responses: list[httpx.Response] = []
    worker = threading.Thread(target=lambda: slow_responses.append(slow_request()))
    worker.start()
    assert entered.wait(timeout=5), "the slow request never reached its blocking call"

    started = time.perf_counter()
    health = client.get("/health")
    elapsed = time.perf_counter() - started

    worker.join(timeout=10)
    assert health.status_code == 200
    assert slow_responses and slow_responses[0].status_code < 500
    return elapsed


def test_server_timing_covers_rate_limits_and_token_check(
    app: FastAPI,
    client: TestClient,
) -> None:
    _sign_in_with_fake_auth(app, client)

    response = client.get("/groups")

    assert response.status_code == 200
    stages = _server_timing(response)
    expected = {"ratelimit.ip", "auth.token", "ratelimit.user", "auth.session.resolve"}
    assert expected <= stages.keys()
    assert stages["request.total"] >= stages["ratelimit.ip"] + stages["ratelimit.user"]


def test_request_total_includes_time_spent_before_the_route(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original = RequestRateLimiter._evaluate_policy

    def slow_rate_limit(*args, **kwargs):  # type: ignore[no-untyped-def]
        time.sleep(0.2)
        return original(*args, **kwargs)

    monkeypatch.setattr(RequestRateLimiter, "_evaluate_policy", slow_rate_limit)

    response = client.get("/auth/session")

    stages = _server_timing(response)
    assert stages["ratelimit.ip"] >= 200
    assert stages["request.total"] >= stages["ratelimit.ip"]


def _completed_request_records(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    return [record for record in caplog.records if record.getMessage() == "request_completed"]


def _assert_rate_limited_response_is_complete(
    limited: httpx.Response,
    caplog: pytest.LogCaptureFixture,
    *,
    limit_stage: str,
) -> None:
    assert limited.status_code == 429
    assert limited.json()["error"]["code"] == "rate_limit_exceeded"
    assert limited.headers["X-Request-ID"]
    assert limited.headers["Retry-After"]
    assert limited.headers["X-RateLimit-Remaining"] == "0"
    assert limited.headers["X-Content-Type-Options"] == "nosniff"
    stages = _server_timing(limited)
    assert {limit_stage, "request.total"} <= stages.keys()

    record = _completed_request_records(caplog)[-1]
    assert record.status_code == 429
    assert record.request_id == limited.headers["X-Request-ID"]
    assert {limit_stage, "request.total"} <= {stage["name"] for stage in record.server_timing}


def test_ip_rate_limited_responses_are_timed_logged_and_keep_headers(
    client: TestClient,
    caplog: pytest.LogCaptureFixture,
) -> None:
    client.app.state.settings.rate_limit_public_get_ip = "1/60"
    _middleware(client.app).rate_limiter = RequestRateLimiter(client.app.state.settings)

    client.get("/auth/session")
    with caplog.at_level(logging.INFO, logger="gust.api"):
        limited = client.get("/auth/session")

    _assert_rate_limited_response_is_complete(limited, caplog, limit_stage="ratelimit.ip")


def test_user_rate_limited_responses_are_timed_logged_and_keep_headers(
    app: FastAPI,
    client: TestClient,
    caplog: pytest.LogCaptureFixture,
) -> None:
    _sign_in_with_fake_auth(app, client)
    client.app.state.settings.rate_limit_authenticated_get_user = "1/60"
    _middleware(client.app).rate_limiter = RequestRateLimiter(client.app.state.settings)

    client.get("/groups")
    with caplog.at_level(logging.INFO, logger="gust.api"):
        limited = client.get("/groups")

    _assert_rate_limited_response_is_complete(limited, caplog, limit_stage="ratelimit.user")
    assert "auth.token" in _server_timing(limited)


def test_auth_service_is_built_once_and_shared_with_the_middleware(app: FastAPI) -> None:
    request = SimpleNamespace(app=app)
    with TestClient(app):
        assert _middleware(app).auth_service is app.state.auth_service
        assert get_auth_service(request, app.state.settings) is app.state.auth_service


def test_signing_keys_are_fetched_once_across_requests(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    private_key = ec.generate_private_key(ec.SECP256R1())
    clients_built: list[str] = []

    class FakeJwksClient:
        def __init__(self, uri: str, timeout: float) -> None:
            del timeout
            clients_built.append(uri)

        def get_signing_key_from_jwt(self, token: str) -> SimpleNamespace:
            del token
            return SimpleNamespace(key=private_key.public_key())

    monkeypatch.setattr(auth_module, "PyJWKClient", FakeJwksClient)
    with connection_scope(client.app.state.settings.database_url) as connection:
        upsert_user(
            connection,
            user_id=USER_ID,
            email="user@example.com",
            display_name="Gust User",
            timezone="UTC",
        )
    now = datetime.now(UTC)
    access_token = jwt.encode(
        {
            "sub": USER_ID,
            "email": "user@example.com",
            "iss": "http://supabase.test/auth/v1",
            "iat": now,
            "exp": now + timedelta(hours=1),
        },
        private_key,
        algorithm="ES256",
    )
    client.cookies.set(ACCESS_TOKEN_COOKIE, access_token)

    responses = [client.get("/auth/session") for _ in range(3)]

    assert [response.json()["signed_in"] for response in responses] == [True, True, True]
    assert len(clients_built) == 1


def test_lifespan_gives_supabase_auth_one_shared_http_client(app: FastAPI) -> None:
    auth_service = app.state.auth_service
    assert auth_service.http_client is None

    with TestClient(app):
        assert isinstance(auth_service.http_client, httpx.AsyncClient)

    assert auth_service.http_client is None


def test_rate_limit_writes_do_not_stall_other_requests(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    entered = threading.Event()
    monkeypatch.setattr(
        RequestRateLimiter,
        "_evaluate_policy",
        _slowed(RequestRateLimiter._evaluate_policy, entered),
    )

    latency = _health_latency_while(client, lambda: client.get("/auth/session"), entered)

    assert latency < RESPONSIVE_SECONDS


def test_token_validation_does_not_stall_other_requests(
    app: FastAPI,
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The middleware validates the token first; a signing-key fetch there must not block.
    _sign_in_with_fake_auth(app, client)
    entered = threading.Event()
    slowed = _slowed(FakeAuthService.validate_access_token, entered)
    original = FakeAuthService.validate_access_token

    def slow_first_call(*args, **kwargs):  # type: ignore[no-untyped-def]
        # /health sends the same cookie, so only the slow request's check may block.
        if entered.is_set():
            return original(*args, **kwargs)
        return slowed(*args, **kwargs)

    monkeypatch.setattr(FakeAuthService, "validate_access_token", slow_first_call)

    latency = _health_latency_while(client, lambda: client.get("/groups"), entered)

    assert latency < RESPONSIVE_SECONDS


def test_refresh_only_session_is_timed_and_user_rate_limited(
    app: FastAPI,
    client: TestClient,
) -> None:
    refreshed_with: list[str] = []

    class RefreshingAuthService(FakeAuthService):
        async def refresh_session(self, *, refresh_token: str) -> AuthenticatedSession:
            refreshed_with.append(refresh_token)
            return AuthenticatedSession(
                tokens=TokenBundle(
                    access_token="access-token",
                    refresh_token="next-refresh-token",
                    expires_in=3600,
                ),
                identity=self.validate_access_token("access-token"),
            )

    _sign_in_with_fake_auth(app, client)
    app.dependency_overrides[get_auth_service] = lambda: RefreshingAuthService()
    _middleware(app).auth_service = RefreshingAuthService()
    client.cookies.delete(ACCESS_TOKEN_COOKIE)
    client.cookies.set(REFRESH_TOKEN_COOKIE, "refresh-token")

    response = client.get("/groups")

    assert response.status_code == 200
    # The middleware refreshes once and hands the session to the route's auth dependency.
    assert refreshed_with == ["refresh-token"]
    stages = _server_timing(response)
    assert {"auth.refresh", "ratelimit.user"} <= stages.keys()
    assert "auth.token" not in stages


def test_session_lookup_does_not_stall_other_requests(
    app: FastAPI,
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _sign_in_with_fake_auth(app, client)
    entered = threading.Event()
    monkeypatch.setattr(
        dependencies_module,
        "get_session_context",
        _slowed(dependencies_module.get_session_context, entered),
    )

    latency = _health_latency_while(client, lambda: client.get("/groups"), entered)

    assert latency < RESPONSIVE_SECONDS


def test_staging_queries_do_not_stall_other_requests(
    app: FastAPI,
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _sign_in_with_fake_auth(app, client)
    entered = threading.Event()
    monkeypatch.setattr(
        staging_module,
        "list_extracted_tasks",
        _slowed(staging_module.list_extracted_tasks, entered),
    )

    latency = _health_latency_while(
        client,
        lambda: client.get("/captures/pending-tasks"),
        entered,
    )

    assert latency < RESPONSIVE_SECONDS


def test_reminder_job_does_not_stall_other_requests(client: TestClient) -> None:
    client.app.state.settings.internal_job_shared_secret = "job-secret"
    entered = threading.Event()

    class BlockingReminderWorker:
        async def run_due_work(self, *, mode: str) -> ReminderRunSummary:
            entered.set()
            # Stands in for the worker's synchronous database calls.
            time.sleep(BLOCKING_SECONDS)
            return ReminderRunSummary(
                mode=mode,
                users_processed=0,
                sent=0,
                skipped_empty=0,
                failed=0,
                captures_deleted=0,
            )

    client.app.dependency_overrides[get_reminder_worker_service] = BlockingReminderWorker

    latency = _health_latency_while(
        client,
        lambda: client.post(
            "/internal/reminders/run?mode=task",
            headers={INTERNAL_JOB_SECRET_HEADER: "job-secret"},
        ),
        entered,
    )

    assert latency < RESPONSIVE_SECONDS


def test_capture_lock_writes_run_in_worker_threads(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    lock_threads: list[threading.Thread] = []

    def recorded(func):  # type: ignore[no-untyped-def]
        def call(**kwargs):  # type: ignore[no-untyped-def]
            lock_threads.append(threading.current_thread())
            return func(**kwargs)

        return call

    monkeypatch.setattr(
        action_locks_module,
        "_acquire_action_lock",
        recorded(action_locks_module._acquire_action_lock),
    )
    monkeypatch.setattr(
        action_locks_module,
        "_release_action_lock",
        recorded(action_locks_module._release_action_lock),
    )

    async def hold_lock() -> threading.Thread:
        async with user_action_lock(
            database_url=client.app.state.settings.database_url,
            user_id=USER_ID,
            action="capture_text",
        ):
            return threading.current_thread()

    loop_thread = asyncio.run(hold_lock())

    assert len(lock_threads) == 2
    assert all(thread is not loop_thread for thread in lock_threads)
