from __future__ import annotations

import secrets
from datetime import UTC, datetime, time, timedelta
from typing import Annotated
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Query, Request, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field, field_validator

from app.core.dependencies import (
    get_current_session_context,
    get_pushover_service,
    require_csrf,
)
from app.core.errors import ApiError, ConfigurationError
from app.core.settings import Settings, get_settings
from app.db.engine import user_connection_scope
from app.db.repositories import (
    NotificationPreferencesRecord,
    SessionContext,
    cancel_pending_reminders_for_user,
    get_notification_preferences,
    increment_rate_limit_counter,
    list_open_tasks_with_reminders,
    update_notification_preferences,
)
from app.services.pushover import PushoverDeliveryError, PushoverService, user_key_hint
from app.services.task_service import TaskService

router = APIRouter()
PUSHOVER_STATE_COOKIE = "gust_pushover_state"
PUSHOVER_STATE_MAX_AGE_SECONDS = 600
ALLOWED_RETURN_PATHS = {"/settings", "/desktop/settings"}

SessionDep = Annotated[SessionContext, Depends(get_current_session_context)]
CsrfSessionDep = Annotated[SessionContext, Depends(require_csrf)]
PushoverServiceDep = Annotated[PushoverService, Depends(get_pushover_service)]


class NotificationSettingsResponse(BaseModel):
    email_daily_enabled: bool
    email_weekly_enabled: bool
    pushover_enabled: bool
    pushover_task_reminders_enabled: bool
    pushover_daily_digest_enabled: bool
    pushover_weekly_digest_enabled: bool
    date_only_reminder_time: time
    timezone: str
    pushover_connected: bool
    pushover_user_key_hint: str | None
    pushover_connection_error_code: str | None
    pushover_available: bool


class UpdateNotificationSettingsRequest(BaseModel):
    email_daily_enabled: bool | None = None
    email_weekly_enabled: bool | None = None
    pushover_enabled: bool | None = None
    pushover_task_reminders_enabled: bool | None = None
    pushover_daily_digest_enabled: bool | None = None
    pushover_weekly_digest_enabled: bool | None = None
    date_only_reminder_time: time | None = None


class ManualPushoverKeyRequest(BaseModel):
    user_key: str = Field(min_length=30, max_length=30)

    @field_validator("user_key")
    @classmethod
    def _validate_user_key(cls, value: str) -> str:
        normalized = value.strip()
        if len(normalized) != 30 or not normalized.isalnum():
            raise ValueError("Pushover user key is invalid.")
        return normalized


class PushoverConnectResponse(BaseModel):
    subscription_url: str


def _response(
    preferences: NotificationPreferencesRecord,
    *,
    timezone: str,
    pushover_available: bool,
) -> NotificationSettingsResponse:
    return NotificationSettingsResponse(
        email_daily_enabled=preferences.email_daily_enabled,
        email_weekly_enabled=preferences.email_weekly_enabled,
        pushover_enabled=preferences.pushover_enabled,
        pushover_task_reminders_enabled=preferences.pushover_task_reminders_enabled,
        pushover_daily_digest_enabled=preferences.pushover_daily_digest_enabled,
        pushover_weekly_digest_enabled=preferences.pushover_weekly_digest_enabled,
        date_only_reminder_time=preferences.date_only_reminder_time,
        timezone=timezone,
        pushover_connected=preferences.pushover_user_key_encrypted is not None,
        pushover_user_key_hint=preferences.pushover_user_key_hint,
        pushover_connection_error_code=preferences.pushover_connection_error_code,
        pushover_available=pushover_available,
    )


def _reconcile_task_reminders(
    *,
    connection,
    user_id: str,
    timezone: str,
    preferences: NotificationPreferencesRecord,
    settings: Settings,
) -> None:
    now = datetime.now(UTC)
    for task in list_open_tasks_with_reminders(connection, user_id=user_id):
        TaskService._sync_task_reminder(
            connection,
            settings=settings,
            user_id=user_id,
            task=task,
            user_timezone=timezone,
            now=now,
        )


@router.get("", response_model=NotificationSettingsResponse)
def get_notification_settings(
    session_context: SessionDep,
    pushover_service: PushoverServiceDep,
    settings: Annotated[Settings, Depends(get_settings)],
) -> NotificationSettingsResponse:
    with user_connection_scope(
        settings.database_url, user_id=session_context.user.id
    ) as connection:
        preferences = get_notification_preferences(connection, user_id=session_context.user.id)
    return _response(
        preferences,
        timezone=session_context.user.timezone,
        pushover_available=pushover_service.is_enabled,
    )


@router.patch("", response_model=NotificationSettingsResponse)
def update_notification_settings(
    payload: UpdateNotificationSettingsRequest,
    session_context: CsrfSessionDep,
    pushover_service: PushoverServiceDep,
    settings: Annotated[Settings, Depends(get_settings)],
) -> NotificationSettingsResponse:
    values = payload.model_dump(exclude_none=True)
    with user_connection_scope(
        settings.database_url, user_id=session_context.user.id
    ) as connection:
        preferences = update_notification_preferences(
            connection,
            user_id=session_context.user.id,
            values=values,
        )
        if not preferences.pushover_enabled or not preferences.pushover_task_reminders_enabled:
            cancel_pending_reminders_for_user(connection, user_id=session_context.user.id)
        else:
            _reconcile_task_reminders(
                connection=connection,
                user_id=session_context.user.id,
                timezone=session_context.user.timezone,
                preferences=preferences,
                settings=settings,
            )
    return _response(
        preferences,
        timezone=session_context.user.timezone,
        pushover_available=pushover_service.is_enabled,
    )


@router.post("/pushover/connect", response_model=PushoverConnectResponse)
def begin_pushover_connect(
    response: Response,
    session_context: CsrfSessionDep,
    pushover_service: PushoverServiceDep,
    settings: Annotated[Settings, Depends(get_settings)],
    return_path: Annotated[str, Query()] = "/settings",
) -> PushoverConnectResponse:
    del session_context
    if return_path not in ALLOWED_RETURN_PATHS:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "invalid_return_path", "Invalid return path."
        )
    pushover_service.ensure_configured(require_subscription=True)
    if not settings.backend_public_url:
        raise ConfigurationError("Pushover callback configuration is missing.")
    state = secrets.token_urlsafe(32)
    callback = f"{settings.backend_public_url.rstrip('/')}/settings/notifications/pushover/callback"
    callback = f"{callback}?{urlencode({'state': state, 'return_path': return_path})}"
    separator = "&" if "?" in settings.pushover_subscription_url else "?"
    subscription_url = (
        f"{settings.pushover_subscription_url}{separator}{urlencode({'success': callback})}"
    )
    response.set_cookie(
        PUSHOVER_STATE_COOKIE,
        state,
        max_age=PUSHOVER_STATE_MAX_AGE_SECONDS,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        domain=settings.session_cookie_domain,
        path="/settings/notifications/pushover",
    )
    return PushoverConnectResponse(subscription_url=subscription_url)


@router.get("/pushover/callback")
async def complete_pushover_connect(
    request: Request,
    response: Response,
    session_context: SessionDep,
    pushover_service: PushoverServiceDep,
    settings: Annotated[Settings, Depends(get_settings)],
    state: Annotated[str, Query()],
    user: Annotated[str | None, Query()] = None,
    return_path: Annotated[str, Query()] = "/settings",
) -> RedirectResponse:
    cookie_state = request.cookies.get(PUSHOVER_STATE_COOKIE) or ""
    if (
        return_path not in ALLOWED_RETURN_PATHS
        or not cookie_state
        or not secrets.compare_digest(cookie_state, state)
    ):
        raise ApiError(
            status.HTTP_403_FORBIDDEN,
            "pushover_state_invalid",
            "Pushover connection could not be verified.",
        )
    if not user:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "pushover_user_key_missing",
            "Pushover did not return a user key.",
        )
    try:
        await pushover_service.validate_user_key(user_key=user)
    except PushoverDeliveryError as exc:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT, exc.error_code, "Pushover user key is invalid."
        ) from exc
    with user_connection_scope(
        settings.database_url, user_id=session_context.user.id
    ) as connection:
        update_notification_preferences(
            connection,
            user_id=session_context.user.id,
            values={
                "pushover_user_key_encrypted": pushover_service.encrypt_user_key(user),
                "pushover_user_key_hint": user_key_hint(user),
                "pushover_verified_at": datetime.now(UTC),
                "pushover_connection_error_code": None,
            },
        )
    redirect = RedirectResponse(
        f"{(settings.frontend_app_url or '').rstrip('/')}{return_path}?pushover=connected"
    )
    redirect.delete_cookie(
        PUSHOVER_STATE_COOKIE,
        domain=settings.session_cookie_domain,
        path="/settings/notifications/pushover",
    )
    return redirect


@router.put("/pushover/key", response_model=NotificationSettingsResponse)
async def save_pushover_key(
    payload: ManualPushoverKeyRequest,
    session_context: CsrfSessionDep,
    pushover_service: PushoverServiceDep,
    settings: Annotated[Settings, Depends(get_settings)],
) -> NotificationSettingsResponse:
    try:
        await pushover_service.validate_user_key(user_key=payload.user_key)
    except PushoverDeliveryError as exc:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT, exc.error_code, "Pushover user key is invalid."
        ) from exc
    with user_connection_scope(
        settings.database_url, user_id=session_context.user.id
    ) as connection:
        preferences = update_notification_preferences(
            connection,
            user_id=session_context.user.id,
            values={
                "pushover_user_key_encrypted": pushover_service.encrypt_user_key(payload.user_key),
                "pushover_user_key_hint": user_key_hint(payload.user_key),
                "pushover_verified_at": datetime.now(UTC),
                "pushover_connection_error_code": None,
            },
        )
    return _response(preferences, timezone=session_context.user.timezone, pushover_available=True)


@router.post("/pushover/test", status_code=status.HTTP_204_NO_CONTENT)
async def send_pushover_test(
    session_context: CsrfSessionDep,
    pushover_service: PushoverServiceDep,
    settings: Annotated[Settings, Depends(get_settings)],
) -> None:
    now = datetime.now(UTC)
    with user_connection_scope(
        settings.database_url, user_id=session_context.user.id
    ) as connection:
        preferences = get_notification_preferences(connection, user_id=session_context.user.id)
        count = increment_rate_limit_counter(
            connection,
            scope="pushover_test",
            subject_key=session_context.user.id,
            window_start=now.replace(minute=0, second=0, microsecond=0),
            window_seconds=3600,
            expires_at=now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1),
        )
    if count > 3:
        raise ApiError(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "pushover_test_rate_limited",
            "Please try again later.",
        )
    if not preferences.pushover_enabled or not preferences.pushover_user_key_encrypted:
        raise ApiError(
            status.HTTP_409_CONFLICT, "pushover_not_connected", "Connect and enable Pushover first."
        )
    user_key = pushover_service.decrypt_user_key(preferences.pushover_user_key_encrypted)
    await pushover_service.send(
        user_key=user_key,
        title="Gust",
        message="Pushover notifications are connected.",
        url=f"{(settings.frontend_app_url or '').rstrip('/')}/tasks",
        ttl_seconds=24 * 60 * 60,
    )


@router.delete("/pushover", response_model=NotificationSettingsResponse)
def disconnect_pushover(
    session_context: CsrfSessionDep,
    pushover_service: PushoverServiceDep,
    settings: Annotated[Settings, Depends(get_settings)],
) -> NotificationSettingsResponse:
    with user_connection_scope(
        settings.database_url, user_id=session_context.user.id
    ) as connection:
        cancel_pending_reminders_for_user(connection, user_id=session_context.user.id)
        preferences = update_notification_preferences(
            connection,
            user_id=session_context.user.id,
            values={
                "pushover_enabled": False,
                "pushover_user_key_encrypted": None,
                "pushover_user_key_hint": None,
                "pushover_verified_at": None,
                "pushover_connection_error_code": None,
            },
        )
    return _response(
        preferences,
        timezone=session_context.user.timezone,
        pushover_available=pushover_service.is_enabled,
    )
