from __future__ import annotations

import logging
import re
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.errors import build_error_response
from app.core.rate_limits import RequestRateLimiter
from app.core.request_security import set_response_security_headers
from app.core.security import ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE
from app.core.settings import Settings
from app.core.timing import begin_request_timing, record_timing, reset_request_timing
from app.services.auth import ExpiredSignatureError, build_auth_service

logger = logging.getLogger("gust.api")
_REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")


class RequestContextMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, *, settings: Settings) -> None:
        super().__init__(app)
        self.settings = settings
        self.rate_limiter = RequestRateLimiter(settings)
        self.auth_service = build_auth_service(settings)

    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = _safe_request_id(request.headers.get("X-Request-ID"))
        request.state.request_id = request_id

        rate_limit = self.rate_limiter.evaluate_ip_request(request=request)
        if rate_limit is not None and rate_limit.exceeded:
            return self._rate_limited_response(request, request_id, rate_limit.headers)

        user_id = await self._resolve_rate_limit_user_id(request)
        user_rate_limit = None
        if user_id is not None:
            user_rate_limit = self.rate_limiter.evaluate_user_request(
                request=request,
                user_id=user_id,
            )
            if user_rate_limit is not None and user_rate_limit.exceeded:
                return self._rate_limited_response(
                    request,
                    request_id,
                    user_rate_limit.headers,
                )

        started_at = time.perf_counter()
        recorder, timing_token = begin_request_timing()
        try:
            response = await call_next(request)
        finally:
            record_timing("request.total", (time.perf_counter() - started_at) * 1000)
            reset_request_timing(timing_token)
        duration_ms = round((time.perf_counter() - started_at) * 1000, 2)

        response.headers["X-Request-ID"] = request_id
        if recorder.segments:
            response.headers["Server-Timing"] = recorder.as_server_timing_header()
        response_rate_limit = user_rate_limit or rate_limit
        if response_rate_limit is not None:
            for key, value in response_rate_limit.headers.items():
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

    async def _resolve_rate_limit_user_id(self, request: Request) -> str | None:
        access_token = request.cookies.get(ACCESS_TOKEN_COOKIE)
        if access_token:
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

        refresh_token = request.cookies.get(REFRESH_TOKEN_COOKIE)
        if not refresh_token:
            return None

        try:
            prefetched_session = await self.auth_service.refresh_session(
                refresh_token=refresh_token,
            )
        except Exception:
            return None

        request.state.prefetched_session = prefetched_session
        return prefetched_session.identity.user_id

    @staticmethod
    def _rate_limited_response(
        request: Request,
        request_id: str,
        headers: dict[str, str],
    ) -> Response:
        response = build_error_response(
            request,
            status_code=429,
            code="rate_limit_exceeded",
            message="Rate limit exceeded. Please retry shortly.",
            headers=headers,
        )
        set_response_security_headers(request, response)
        response.headers["X-Request-ID"] = request_id
        return response


def _safe_request_id(candidate: str | None) -> str:
    if candidate is not None and _REQUEST_ID_PATTERN.fullmatch(candidate):
        return candidate
    return str(uuid.uuid4())
