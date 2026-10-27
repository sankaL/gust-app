from __future__ import annotations

import logging
import re
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.concurrency import run_blocking
from app.core.errors import build_error_response
from app.core.rate_limits import RequestRateLimiter
from app.core.request_security import set_response_security_headers
from app.core.security import ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE
from app.core.settings import Settings
from app.core.timing import begin_request_timing, record_timing, reset_request_timing, timed_stage
from app.services.auth import AuthService, ExpiredSignatureError, build_auth_service

logger = logging.getLogger("gust.api")
_REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")


class RequestContextMiddleware(BaseHTTPMiddleware):
    def __init__(
        self,
        app,
        *,
        settings: Settings,
        auth_service: AuthService | None = None,
    ) -> None:
        super().__init__(app)
        self.settings = settings
        self.rate_limiter = RequestRateLimiter(settings)
        self.auth_service = auth_service or build_auth_service(settings)

    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = _safe_request_id(request.headers.get("X-Request-ID"))
        request.state.request_id = request_id

        # Time from the moment the request arrives, so the logged duration includes the rate-limit
        # and token checks below, not only the route.
        started_at = time.perf_counter()
        recorder, timing_token = begin_request_timing()
        try:
            response, rate_limit_headers = await self._rate_limit_then_call_next(
                request,
                call_next,
            )
        finally:
            record_timing("request.total", (time.perf_counter() - started_at) * 1000)
            reset_request_timing(timing_token)
        duration_ms = round((time.perf_counter() - started_at) * 1000, 2)

        response.headers["X-Request-ID"] = request_id
        if recorder.segments:
            response.headers["Server-Timing"] = recorder.as_server_timing_header()
        for key, value in rate_limit_headers.items():
            response.headers.setdefault(key, value)
        set_response_security_headers(request, response)

        logger.info(
            "request_completed",
            extra={
                "event": "request_completed",
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "duration_ms": duration_ms,
                "server_timing": recorder.as_log_payload(),
            },
        )
        return response

    async def _rate_limit_then_call_next(
        self,
        request: Request,
        call_next,
    ) -> tuple[Response, dict[str, str]]:
        rate_limit = await self.rate_limiter.evaluate_ip_request(request=request)
        if rate_limit is not None and rate_limit.exceeded:
            return self._rate_limited_response(request, rate_limit.headers), {}

        user_id = await self._resolve_rate_limit_user_id(request)
        user_rate_limit = None
        if user_id is not None:
            user_rate_limit = await self.rate_limiter.evaluate_user_request(
                request=request,
                user_id=user_id,
            )
            if user_rate_limit is not None and user_rate_limit.exceeded:
                return self._rate_limited_response(request, user_rate_limit.headers), {}

        response = await call_next(request)
        response_rate_limit = user_rate_limit or rate_limit
        return response, response_rate_limit.headers if response_rate_limit is not None else {}

    async def _resolve_rate_limit_user_id(self, request: Request) -> str | None:
        access_token = request.cookies.get(ACCESS_TOKEN_COOKIE)
        if access_token:
            with timed_stage("auth.token"):
                # Validation can fetch Supabase's signing keys over the network.
                return await run_blocking(self._rate_limit_subject, access_token)

        refresh_token = request.cookies.get(REFRESH_TOKEN_COOKIE)
        if not refresh_token:
            return None

        try:
            with timed_stage("auth.refresh"):
                prefetched_session = await self.auth_service.refresh_session(
                    refresh_token=refresh_token,
                )
        except Exception:
            return None

        request.state.prefetched_session = prefetched_session
        return prefetched_session.identity.user_id

    def _rate_limit_subject(self, access_token: str) -> str | None:
        try:
            return self.auth_service.validate_access_token(access_token).user_id
        except ExpiredSignatureError:
            try:
                return self.auth_service.validate_access_token(
                    access_token,
                    allow_expired=True,
                ).user_id
            except Exception:
                return None
        except Exception:
            return None

    @staticmethod
    def _rate_limited_response(request: Request, headers: dict[str, str]) -> Response:
        return build_error_response(
            request,
            status_code=429,
            code="rate_limit_exceeded",
            message="Rate limit exceeded. Please retry shortly.",
            headers=headers,
        )


def _safe_request_id(candidate: str | None) -> str:
    if candidate is not None and _REQUEST_ID_PATTERN.fullmatch(candidate):
        return candidate
    return str(uuid.uuid4())
