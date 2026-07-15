from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from starlette.requests import Request

from app.core.request_security import client_ip_for_request
from app.core.settings import Settings
from app.db.engine import connection_scope
from app.db.repositories import delete_expired_rate_limit_counters, increment_rate_limit_counter

_CAPTURE_SUBMIT_PATH = re.compile(r"^/captures/[^/]+/submit$")


@dataclass(frozen=True)
class RateLimitWindow:
    limit: int
    window_seconds: int


@dataclass(frozen=True)
class RateLimitPolicy:
    scope: str
    user_windows: tuple[RateLimitWindow, ...] = ()
    ip_windows: tuple[RateLimitWindow, ...] = ()
    primary_subject: str = "ip"


@dataclass(frozen=True)
class RateLimitState:
    limit: int
    remaining: int
    reset_epoch: int
    retry_after: int | None = None

    def as_headers(self, *, include_retry_after: bool) -> dict[str, str]:
        headers = {
            "X-RateLimit-Limit": str(self.limit),
            "X-RateLimit-Remaining": str(self.remaining),
            "X-RateLimit-Reset": str(self.reset_epoch),
        }
        if include_retry_after and self.retry_after is not None:
            headers["Retry-After"] = str(self.retry_after)
        return headers


@dataclass(frozen=True)
class RateLimitEvaluation:
    exceeded: bool
    headers: dict[str, str]


class RequestRateLimiter:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.auth_entry_ip = _parse_windows(settings.rate_limit_auth_entry_ip)
        self.capture_voice_user = _parse_windows(settings.rate_limit_capture_voice_user)
        self.capture_voice_ip = _parse_windows(settings.rate_limit_capture_voice_ip)
        self.capture_text_user = _parse_windows(settings.rate_limit_capture_text_user)
        self.capture_text_ip = _parse_windows(settings.rate_limit_capture_text_ip)
        self.capture_submit_user = _parse_windows(settings.rate_limit_capture_submit_user)
        self.capture_submit_ip = _parse_windows(settings.rate_limit_capture_submit_ip)
        self.authenticated_write_user = _parse_windows(settings.rate_limit_authenticated_write_user)
        self.authenticated_get_user = _parse_windows(settings.rate_limit_authenticated_get_user)
        self.public_get_ip = _parse_windows(settings.rate_limit_public_get_ip)
        self.unauthenticated_write_ip = _parse_windows(settings.rate_limit_unauthenticated_write_ip)
        self.internal_job_ip = _parse_windows(settings.rate_limit_internal_job_ip)

    def evaluate_ip_request(
        self,
        *,
        request: Request,
    ) -> RateLimitEvaluation | None:
        if request.method == "OPTIONS":
            return None

        policy = self._resolve_ip_policy(request=request)
        if policy is None:
            return None
        return self._evaluate_policy(
            request=request,
            policy=policy,
            user_id=None,
            cleanup_expired=True,
        )

    def evaluate_user_request(
        self,
        *,
        request: Request,
        user_id: str,
    ) -> RateLimitEvaluation | None:
        if request.method == "OPTIONS":
            return None

        policy = self._resolve_user_policy(request=request)
        if policy is None:
            return None
        return self._evaluate_policy(
            request=request,
            policy=policy,
            user_id=user_id,
            cleanup_expired=False,
        )

    def _evaluate_policy(
        self,
        *,
        request: Request,
        policy: RateLimitPolicy,
        user_id: str | None,
        cleanup_expired: bool,
    ) -> RateLimitEvaluation | None:

        now = datetime.now(UTC)
        client_ip = client_ip_for_request(request, self.settings)
        primary_state: RateLimitState | None = None
        exceeded_state: RateLimitState | None = None

        with connection_scope(self.settings.database_url) as connection:
            if cleanup_expired:
                delete_expired_rate_limit_counters(connection, now=now, limit=500)

            if policy.user_windows and user_id is not None:
                current_state = self._evaluate_subject(
                    connection=connection,
                    scope=policy.scope,
                    subject_key=f"user:{user_id}",
                    windows=policy.user_windows,
                    now=now,
                )
                if policy.primary_subject == "user":
                    primary_state = current_state[0]
                if current_state[1] is not None:
                    exceeded_state = current_state[1]

            if policy.ip_windows:
                current_state = self._evaluate_subject(
                    connection=connection,
                    scope=policy.scope,
                    subject_key=f"ip:{client_ip}",
                    windows=policy.ip_windows,
                    now=now,
                )
                if primary_state is None or policy.primary_subject == "ip":
                    primary_state = current_state[0]
                if exceeded_state is None and current_state[1] is not None:
                    exceeded_state = current_state[1]

        if primary_state is None:
            return None
        if exceeded_state is not None:
            return RateLimitEvaluation(
                exceeded=True,
                headers=exceeded_state.as_headers(include_retry_after=True),
            )
        return RateLimitEvaluation(
            exceeded=False,
            headers=primary_state.as_headers(include_retry_after=False),
        )

    def _resolve_ip_policy(
        self,
        *,
        request: Request,
    ) -> RateLimitPolicy | None:
        path = request.url.path
        method = request.method.upper()

        if path == "/health":
            return None

        if path in {
            "/auth/session/google/start",
            "/auth/session/callback",
            "/auth/session/dev-login",
        }:
            return RateLimitPolicy(
                scope="auth_entry",
                ip_windows=self.auth_entry_ip,
                primary_subject="ip",
            )

        if method == "POST" and path == "/captures/voice":
            return RateLimitPolicy(
                scope="capture_voice",
                ip_windows=self.capture_voice_ip,
                primary_subject="ip",
            )

        if method == "POST" and path == "/captures/text":
            return RateLimitPolicy(
                scope="capture_text",
                ip_windows=self.capture_text_ip,
                primary_subject="ip",
            )

        if method == "POST" and _CAPTURE_SUBMIT_PATH.fullmatch(path):
            return RateLimitPolicy(
                scope="capture_submit",
                ip_windows=self.capture_submit_ip,
                primary_subject="ip",
            )

        if path.startswith("/internal/reminders"):
            return RateLimitPolicy(
                scope="internal_job",
                ip_windows=self.internal_job_ip,
                primary_subject="ip",
            )

        if method in {"GET", "HEAD"}:
            return RateLimitPolicy(
                scope="public_get",
                ip_windows=self.public_get_ip,
                primary_subject="ip",
            )

        if method in {"POST", "PUT", "PATCH", "DELETE"}:
            return RateLimitPolicy(
                scope="unauthenticated_write",
                ip_windows=self.unauthenticated_write_ip,
                primary_subject="ip",
            )

        return None

    def _resolve_user_policy(self, *, request: Request) -> RateLimitPolicy | None:
        path = request.url.path
        method = request.method.upper()

        if method == "POST" and path == "/captures/voice":
            windows = self.capture_voice_user
            scope = "capture_voice"
        elif method == "POST" and path == "/captures/text":
            windows = self.capture_text_user
            scope = "capture_text"
        elif method == "POST" and _CAPTURE_SUBMIT_PATH.fullmatch(path):
            windows = self.capture_submit_user
            scope = "capture_submit"
        elif method in {"GET", "HEAD"}:
            windows = self.authenticated_get_user
            scope = "authenticated_get"
        elif method in {"POST", "PUT", "PATCH", "DELETE"}:
            windows = self.authenticated_write_user
            scope = "authenticated_write"
        else:
            return None

        return RateLimitPolicy(
            scope=scope,
            user_windows=windows,
            primary_subject="user",
        )

    def _evaluate_subject(
        self,
        *,
        connection,
        scope: str,
        subject_key: str,
        windows: tuple[RateLimitWindow, ...],
        now: datetime,
    ) -> tuple[RateLimitState, RateLimitState | None]:
        primary_state: RateLimitState | None = None
        exceeded_state: RateLimitState | None = None

        for index, window in enumerate(windows):
            window_start = _window_start(now=now, window_seconds=window.window_seconds)
            reset_at = window_start + timedelta(seconds=window.window_seconds)
            request_count = increment_rate_limit_counter(
                connection,
                scope=scope,
                subject_key=subject_key,
                window_start=window_start,
                window_seconds=window.window_seconds,
                expires_at=reset_at,
            )
            remaining = max(window.limit - request_count, 0)
            retry_after = max(int((reset_at - now).total_seconds()), 1)
            state = RateLimitState(
                limit=window.limit,
                remaining=remaining,
                reset_epoch=int(reset_at.timestamp()),
                retry_after=retry_after,
            )
            if index == 0:
                primary_state = state
            if exceeded_state is None and request_count > window.limit:
                exceeded_state = state

        assert primary_state is not None
        return primary_state, exceeded_state


def _parse_windows(value: str) -> tuple[RateLimitWindow, ...]:
    windows: list[RateLimitWindow] = []
    for chunk in value.split(","):
        normalized = chunk.strip()
        if not normalized:
            continue
        limit_str, window_seconds_str = normalized.split("/", maxsplit=1)
        limit = int(limit_str.strip())
        window_seconds = int(window_seconds_str)
        if limit <= 0 or window_seconds <= 0:
            raise ValueError("Rate-limit windows must use positive limits and durations.")
        windows.append(RateLimitWindow(limit=limit, window_seconds=window_seconds))
    if not windows:
        raise ValueError("At least one rate-limit window is required.")
    return tuple(windows)


def _window_start(*, now: datetime, window_seconds: int) -> datetime:
    epoch_seconds = int(now.timestamp())
    start_epoch = epoch_seconds - (epoch_seconds % window_seconds)
    return datetime.fromtimestamp(start_epoch, tz=UTC)
