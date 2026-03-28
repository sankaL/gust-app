from __future__ import annotations

import logging
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.timing import begin_request_timing, record_timing, reset_request_timing

logger = logging.getLogger("gust.api")


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        request.state.request_id = request_id

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
