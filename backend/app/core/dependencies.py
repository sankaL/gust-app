from __future__ import annotations

# ruff: noqa: UP045
from typing import Annotated, Optional, Union

from fastapi import Depends, Request, Response

from app.core.errors import (
    AuthEmailNotAllowedError,
    AuthRequiredError,
    ConfigurationError,
    CsrfValidationError,
    InternalJobAuthError,
    OriginValidationError,
)
from app.core.request_security import validate_browser_origin
from app.core.security import (
    ACCESS_TOKEN_COOKIE,
    CSRF_COOKIE,
    CSRF_HEADER,
    REFRESH_TOKEN_COOKIE,
    clear_csrf_cookie,
    clear_session_cookies,
    set_session_cookies,
)
from app.core.settings import Settings, get_settings
from app.core.timing import timed_stage
from app.db.engine import user_connection_scope
from app.db.repositories import SessionContext, get_session_context, is_email_allowed
from app.services.auth import (
    ExpiredSignatureError,
    InvalidTokenError,
    SupabaseAuthService,
)
from app.services.capture import CaptureService
from app.services.extraction import LangChainExtractionService
from app.services.group_service import GroupService
from app.services.reminders import (
    INTERNAL_JOB_SECRET_HEADER,
    ReminderWorkerService,
    ResendReminderService,
)
from app.services.staging import StagingService
from app.services.task_service import TaskService
from app.services.transcription import MistralTranscriptionService, MockTranscriptionService

SettingsDep = Annotated[Settings, Depends(get_settings)]


def get_auth_service(settings: SettingsDep) -> SupabaseAuthService:
    return SupabaseAuthService(settings)


def get_transcription_service(
    settings: SettingsDep,
) -> Union[MistralTranscriptionService, MockTranscriptionService]:
    """Return the appropriate transcription service based on environment.

    In dev mode (GUST_DEV_MODE=true), returns a MockTranscriptionService
    to avoid calling external APIs during local development.
    In production, returns the real MistralTranscriptionService.
    """
    if settings.gust_dev_mode:
        return MockTranscriptionService()
    return MistralTranscriptionService(settings)


def get_extraction_service(settings: SettingsDep) -> LangChainExtractionService:
    return LangChainExtractionService(settings)


def get_capture_service(
    settings: SettingsDep,
    transcription_service: Annotated[
        Union[MistralTranscriptionService, MockTranscriptionService],
        Depends(get_transcription_service),
    ],
    extraction_service: Annotated[
        LangChainExtractionService,
        Depends(get_extraction_service),
    ],
    staging_service: Annotated[
        StagingService,
        Depends(get_staging_service),
    ],
) -> CaptureService:
    return CaptureService(
        settings=settings,
        transcription_service=transcription_service,
        extraction_service=extraction_service,
        staging_service=staging_service,
    )


def get_staging_service(settings: SettingsDep) -> StagingService:
    return StagingService(settings=settings)


def get_task_service(settings: SettingsDep) -> TaskService:
    return TaskService(settings=settings)


def get_resend_reminder_service(settings: SettingsDep) -> ResendReminderService:
    return ResendReminderService(settings)


def get_reminder_worker_service(
    settings: SettingsDep,
    resend_reminder_service: Annotated[
        ResendReminderService,
        Depends(get_resend_reminder_service),
    ],
) -> ReminderWorkerService:
    return ReminderWorkerService(
        settings=settings,
        reminder_delivery_service=resend_reminder_service,
    )


def get_group_service(
    settings: SettingsDep,
    task_service: Annotated[TaskService, Depends(get_task_service)],
) -> GroupService:
    return GroupService(settings=settings, task_service=task_service)


async def get_optional_session_context(
    request: Request,
    response: Response,
    settings: SettingsDep,
    auth_service: Annotated[SupabaseAuthService, Depends(get_auth_service)],
) -> Optional[SessionContext]:
    access_token = request.cookies.get(ACCESS_TOKEN_COOKIE)
    refresh_token = request.cookies.get(REFRESH_TOKEN_COOKIE)
    prefetched_session = getattr(request.state, "prefetched_session", None)

    if prefetched_session is not None:
        identity = prefetched_session.identity
        set_session_cookies(response, settings, prefetched_session.tokens)
    elif access_token:
        try:
            identity = auth_service.validate_access_token(access_token)
        except ExpiredSignatureError:
            if not refresh_token:
                clear_session_cookies(response, settings)
                clear_csrf_cookie(response, settings)
                return None

            try:
                refreshed_session = await auth_service.refresh_session(refresh_token=refresh_token)
                identity = refreshed_session.identity
                set_session_cookies(response, settings, refreshed_session.tokens)
            except Exception:
                clear_session_cookies(response, settings)
                clear_csrf_cookie(response, settings)
                return None
        except InvalidTokenError:
            clear_session_cookies(response, settings)
            clear_csrf_cookie(response, settings)
            return None
    elif refresh_token:
        try:
            refreshed_session = await auth_service.refresh_session(refresh_token=refresh_token)
            identity = refreshed_session.identity
            set_session_cookies(response, settings, refreshed_session.tokens)
        except Exception:
            clear_session_cookies(response, settings)
            clear_csrf_cookie(response, settings)
            return None
    else:
        return None

    with timed_stage("auth.session.resolve"):
        with user_connection_scope(settings.database_url, user_id=identity.user_id) as connection:
            if not is_email_allowed(connection, email=identity.email):
                clear_session_cookies(response, settings)
                clear_csrf_cookie(response, settings)
                raise AuthEmailNotAllowedError()
            return get_session_context(connection, identity.user_id)


async def get_current_session_context(
    session_context: Annotated[Optional[SessionContext], Depends(get_optional_session_context)],
) -> SessionContext:
    if session_context is None:
        raise AuthRequiredError()
    return session_context


def require_csrf(
    request: Request,
    settings: SettingsDep,
    session_context: Annotated[SessionContext, Depends(get_current_session_context)],
) -> SessionContext:
    cookie_token = request.cookies.get(CSRF_COOKIE)
    header_token = request.headers.get(CSRF_HEADER)

    if not cookie_token or not header_token or cookie_token != header_token:
        raise CsrfValidationError()
    if not validate_browser_origin(request, settings):
        raise OriginValidationError()

    return session_context


def require_internal_job_secret(
    request: Request,
    settings: SettingsDep,
) -> None:
    if not settings.internal_job_shared_secret:
        raise ConfigurationError("Internal reminder job configuration is missing.")

    header_value = request.headers.get(INTERNAL_JOB_SECRET_HEADER)
    if header_value != settings.internal_job_shared_secret:
        raise InternalJobAuthError()
