from __future__ import annotations

import logging
from dataclasses import dataclass

from fastapi import HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.core.security import (
    clear_csrf_cookie,
    clear_oauth_code_verifier_cookie,
    clear_session_cookies,
)
from app.db.migrations import MigrationVersionError

logger = logging.getLogger("gust.api")
AUTH_EMAIL_NOT_ALLOWED_MESSAGE = "This email is not allowed to access Gust."


@dataclass
class ApiError(Exception):
    status_code: int
    code: str
    message: str
    headers: dict[str, str] | None = None


class AuthRequiredError(ApiError):
    def __init__(self, message: str = "Authentication is required.") -> None:
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="auth_required",
            message=message,
        )


class AuthEmailNotAllowedError(ApiError):
    def __init__(self, message: str = AUTH_EMAIL_NOT_ALLOWED_MESSAGE) -> None:
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN,
            code="auth_email_not_allowed",
            message=message,
        )


class CsrfValidationError(ApiError):
    def __init__(self, message: str = "CSRF validation failed.") -> None:
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN,
            code="csrf_invalid",
            message=message,
        )


class InternalJobAuthError(ApiError):
    def __init__(self, message: str = "Internal job authentication failed.") -> None:
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN,
            code="internal_job_auth_invalid",
            message=message,
        )


class OriginValidationError(ApiError):
    def __init__(self, message: str = "Request origin validation failed.") -> None:
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN,
            code="origin_invalid",
            message=message,
        )


class ConfigurationError(ApiError):
    def __init__(self, message: str = "Required application configuration is missing.") -> None:
        super().__init__(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="config_missing",
            message=message,
        )


class InvalidConfigurationError(ApiError):
    def __init__(self, message: str = "Required application configuration is invalid.") -> None:
        super().__init__(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="config_invalid",
            message=message,
        )


class InvalidTimezoneError(ApiError):
    def __init__(self, message: str = "Invalid timezone provided.") -> None:
        super().__init__(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="invalid_timezone",
            message=message,
        )


class UpstreamAuthError(ApiError):
    def __init__(self, message: str = "Authentication provider request failed.") -> None:
        super().__init__(
            status_code=status.HTTP_502_BAD_GATEWAY,
            code="auth_provider_error",
            message=message,
        )


class CaptureNotFoundError(ApiError):
    def __init__(self, message: str = "Capture could not be found.") -> None:
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            code="capture_not_found",
            message=message,
        )


class InvalidCaptureError(ApiError):
    def __init__(self, message: str = "Capture input is invalid.") -> None:
        super().__init__(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="invalid_capture",
            message=message,
        )


class CaptureStateConflictError(ApiError):
    def __init__(self, message: str = "Capture is not in a valid state for this action.") -> None:
        super().__init__(
            status_code=status.HTTP_409_CONFLICT,
            code="capture_state_conflict",
            message=message,
        )


class ExtractedTaskNotFoundError(ApiError):
    def __init__(self, message: str = "Extracted task could not be found.") -> None:
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            code="extracted_task_not_found",
            message=message,
        )


class ExtractedTaskStateConflictError(ApiError):
    def __init__(
        self, message: str = "Extracted task is not in a valid state for this action."
    ) -> None:
        super().__init__(
            status_code=status.HTTP_409_CONFLICT,
            code="extracted_task_state_conflict",
            message=message,
        )


class TranscriptionFailedError(ApiError):
    def __init__(self, message: str = "Transcription failed. Please retry.") -> None:
        super().__init__(
            status_code=status.HTTP_502_BAD_GATEWAY,
            code="transcription_failed",
            message=message,
        )


class TranscriptionNoSpeechError(ApiError):
    def __init__(
        self,
        message: str = (
            "No speech was detected. Check your microphone and try again, "
            "or use text capture."
        ),
    ) -> None:
        super().__init__(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="transcription_no_speech",
            message=message,
        )


class TranscriptionTimeoutError(ApiError):
    def __init__(
        self,
        message: str = "Transcription timed out. Check your network and retry.",
    ) -> None:
        super().__init__(
            status_code=status.HTTP_502_BAD_GATEWAY,
            code="transcription_timeout",
            message=message,
        )


class TranscriptionProviderUnavailableError(ApiError):
    def __init__(
        self,
        message: str = "Transcription service is temporarily unavailable. Please retry.",
    ) -> None:
        super().__init__(
            status_code=status.HTTP_502_BAD_GATEWAY,
            code="transcription_provider_unavailable",
            message=message,
        )


class TranscriptionProviderRejectedError(ApiError):
    def __init__(
        self,
        message: str = (
            "The recording could not be transcribed. Retry with clearer audio "
            "or use text capture."
        ),
    ) -> None:
        super().__init__(
            status_code=status.HTTP_502_BAD_GATEWAY,
            code="transcription_provider_rejected",
            message=message,
        )


class TranscriptionProviderInvalidResponseError(ApiError):
    def __init__(
        self,
        message: str = "Transcription service returned an invalid response. Please retry.",
    ) -> None:
        super().__init__(
            status_code=status.HTTP_502_BAD_GATEWAY,
            code="transcription_provider_invalid_response",
            message=message,
        )


class ExtractionFailedError(ApiError):
    def __init__(
        self,
        message: str = "Extraction failed. Please edit the transcript or retry.",
    ) -> None:
        super().__init__(
            status_code=status.HTTP_502_BAD_GATEWAY,
            code="extraction_failed",
            message=message,
        )


class TaskNotFoundError(ApiError):
    def __init__(self, message: str = "Task could not be found.") -> None:
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            code="task_not_found",
            message=message,
        )


class GroupNotFoundError(ApiError):
    def __init__(self, message: str = "Group could not be found.") -> None:
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            code="group_not_found",
            message=message,
        )


class SubtaskNotFoundError(ApiError):
    def __init__(self, message: str = "Subtask could not be found.") -> None:
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            code="subtask_not_found",
            message=message,
        )


class InvalidTaskError(ApiError):
    def __init__(self, message: str = "Task input is invalid.") -> None:
        super().__init__(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="invalid_task",
            message=message,
        )


class InvalidGroupError(ApiError):
    def __init__(self, message: str = "Group input is invalid.") -> None:
        super().__init__(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="invalid_group",
            message=message,
        )


class InvalidSubtaskError(ApiError):
    def __init__(self, message: str = "Subtask input is invalid.") -> None:
        super().__init__(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="invalid_subtask",
            message=message,
        )


class ConflictError(ApiError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(
            status_code=status.HTTP_409_CONFLICT,
            code=code,
            message=message,
        )


class RateLimitExceededError(ApiError):
    def __init__(
        self,
        *,
        message: str = "Rate limit exceeded. Please retry shortly.",
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            code="rate_limit_exceeded",
            message=message,
            headers=headers,
        )


def not_implemented(resource: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail=f"{resource} is scaffolded but not implemented yet.",
    )


def build_error_response(
    request: Request,
    *,
    status_code: int,
    code: str,
    message: str,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None)
    payload = {
        "error": {
            "code": code,
            "message": message,
        }
    }
    if request_id is not None:
        payload["request_id"] = request_id

    response = JSONResponse(status_code=status_code, content=payload)
    if request_id is not None:
        response.headers["X-Request-ID"] = request_id
    if headers:
        for key, value in headers.items():
            response.headers[key] = value
    return response


async def api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
    logger.warning(
        "request_failed",
        extra={
            "event": "request_failed",
            "request_id": getattr(request.state, "request_id", None),
            "path": request.url.path,
            "status_code": exc.status_code,
            "error_code": exc.code,
        },
    )
    response = build_error_response(
        request,
        status_code=exc.status_code,
        code=exc.code,
        message=exc.message,
        headers=exc.headers,
    )
    if isinstance(exc, AuthEmailNotAllowedError):
        settings = getattr(request.app.state, "settings", None)
        if settings is not None:
            clear_session_cookies(response, settings)
            clear_csrf_cookie(response, settings)
            clear_oauth_code_verifier_cookie(response, settings)
    return response


async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    message = exc.detail if isinstance(exc.detail, str) else "Request failed."
    return build_error_response(
        request,
        status_code=exc.status_code,
        code="http_error",
        message=message,
    )


async def validation_exception_handler(
    request: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    logger.warning(
        "request_validation_failed",
        extra={
            "event": "request_validation_failed",
            "request_id": getattr(request.state, "request_id", None),
            "path": request.url.path,
        },
    )
    return build_error_response(
        request,
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        code="validation_error",
        message="Request validation failed.",
    )


async def migration_exception_handler(
    request: Request,
    exc: MigrationVersionError,
) -> JSONResponse:
    logger.error(
        "migration_version_mismatch",
        extra={
            "event": "migration_version_mismatch",
            "request_id": getattr(request.state, "request_id", None),
            "path": request.url.path,
        },
    )
    return build_error_response(
        request,
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        code="migration_version_mismatch",
        message=str(exc),
    )


async def unexpected_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception(
        "unexpected_server_error",
        extra={
            "event": "unexpected_server_error",
            "request_id": getattr(request.state, "request_id", None),
            "path": request.url.path,
        },
    )
    return build_error_response(
        request,
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        code="internal_error",
        message="Unexpected server error.",
    )
