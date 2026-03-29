from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

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

    def evaluate_request(
        self,
        *,
        request: Request,
        user_id: str | None,
    ) -> RateLimitEvaluation | None:
        if request.method in {"HEAD", "OPTIONS"}:
            return None

        policy = self._resolve_policy(request=request, user_id=user_id)
        if policy is None:
            return None

        now = datetime.now(timezone.utc)
        client_ip = client_ip_for_request(request)
        primary_state: RateLimitState | None = None
        exceeded_state: RateLimitState | None = None

        with connection_scope(self.settings.database_url) as connection:
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

    def _resolve_policy(
        self,
        *,
        request: Request,
        user_id: str | None,
    ) -> RateLimitPolicy | None:
        path = request.url.path
        method = request.method.upper()

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
                user_windows=self.capture_voice_user,
                ip_windows=self.capture_voice_ip,
                primary_subject="user" if user_id else "ip",
            )

        if method == "POST" and path == "/captures/text":
            return RateLimitPolicy(
                scope="capture_text",
                user_windows=self.capture_text_user,
                ip_windows=self.capture_text_ip,
                primary_subject="user" if user_id else "ip",
            )

        if method == "POST" and _CAPTURE_SUBMIT_PATH.fullmatch(path):
            return RateLimitPolicy(
                scope="capture_submit",
                user_windows=self.capture_submit_user,
                ip_windows=self.capture_submit_ip,
                primary_subject="user" if user_id else "ip",
            )

        if method == "GET":
            if user_id is not None:
                return RateLimitPolicy(
                    scope="authenticated_get",
                    user_windows=self.authenticated_get_user,
                    primary_subject="user",
                )
            return RateLimitPolicy(
                scope="public_get",
                ip_windows=self.public_get_ip,
                primary_subject="ip",
            )

        if user_id is not None and method in {"POST", "PUT", "PATCH", "DELETE"}:
            return RateLimitPolicy(
                scope="authenticated_write",
                user_windows=self.authenticated_write_user,
                primary_subject="user",
            )

        return None

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
        windows.append(
            RateLimitWindow(limit=int(limit_str.strip()), window_seconds=int(window_seconds_str))
        )
    return tuple(windows)


def _window_start(*, now: datetime, window_seconds: int) -> datetime:
    epoch_seconds = int(now.timestamp())
    start_epoch = epoch_seconds - (epoch_seconds % window_seconds)
    return datetime.fromtimestamp(start_epoch, tz=timezone.utc)
