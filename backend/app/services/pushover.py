from __future__ import annotations

from dataclasses import dataclass

import httpx
from cryptography.fernet import Fernet, InvalidToken

from app.core.errors import ConfigurationError
from app.core.settings import Settings

PUSHOVER_MESSAGE_MAX_CHARS = 1024


@dataclass(frozen=True)
class PushoverSendResult:
    request_id: str


class PushoverDeliveryError(Exception):
    def __init__(self, *, error_code: str, retryable: bool, invalid_user_key: bool = False) -> None:
        super().__init__(error_code)
        self.error_code = error_code
        self.retryable = retryable
        self.invalid_user_key = invalid_user_key


class PushoverService:
    """Small, deliberately redacting adapter for the Pushover REST API."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    @property
    def is_enabled(self) -> bool:
        return self.settings.pushover_notifications_enabled

    def ensure_configured(self, *, require_subscription: bool = False) -> None:
        if not self.is_enabled:
            raise ConfigurationError("Pushover notifications are unavailable.")
        if (
            not self.settings.pushover_app_token
            or not self.settings.pushover_credential_encryption_key
        ):
            raise ConfigurationError("Pushover notification configuration is missing.")
        if require_subscription and not self.settings.pushover_subscription_url:
            raise ConfigurationError("Pushover subscription configuration is missing.")
        try:
            Fernet(self.settings.pushover_credential_encryption_key.encode())
        except (TypeError, ValueError) as exc:
            raise ConfigurationError(
                "Pushover credential encryption configuration is invalid."
            ) from exc

    def encrypt_user_key(self, user_key: str) -> str:
        self.ensure_configured()
        return (
            Fernet(self.settings.pushover_credential_encryption_key.encode())
            .encrypt(user_key.encode())
            .decode()
        )

    def decrypt_user_key(self, encrypted_key: str) -> str:
        self.ensure_configured()
        try:
            return (
                Fernet(self.settings.pushover_credential_encryption_key.encode())
                .decrypt(encrypted_key.encode())
                .decode()
            )
        except (InvalidToken, UnicodeDecodeError) as exc:
            raise PushoverDeliveryError(
                error_code="pushover_credential_invalid", retryable=False
            ) from exc

    async def validate_user_key(self, *, user_key: str) -> None:
        self.ensure_configured()
        response = await self._post(
            "/users/validate.json",
            {"token": self.settings.pushover_app_token, "user": user_key},
        )
        if response.status_code >= 500:
            raise PushoverDeliveryError(error_code="pushover_provider_unavailable", retryable=True)
        if response.status_code >= 400:
            raise PushoverDeliveryError(
                error_code="pushover_user_key_invalid",
                retryable=False,
                invalid_user_key=True,
            )
        if not self._status_success(response):
            raise PushoverDeliveryError(
                error_code="pushover_user_key_invalid",
                retryable=False,
                invalid_user_key=True,
            )

    async def send(
        self,
        *,
        user_key: str,
        title: str,
        message: str,
        url: str,
        ttl_seconds: int,
        html_enabled: bool,
    ) -> PushoverSendResult:
        self.ensure_configured()
        if len(message) > PUSHOVER_MESSAGE_MAX_CHARS:
            raise PushoverDeliveryError(
                error_code="pushover_message_too_long",
                retryable=False,
            )
        payload = {
            "token": self.settings.pushover_app_token,
            "user": user_key,
            "title": title[:250],
            "message": message,
            "url": url[:512],
            "url_title": "Open in Gust",
            "priority": "0",
            "ttl": str(ttl_seconds),
        }
        if html_enabled:
            payload["html"] = "1"
        response = await self._post(
            "/messages.json",
            payload,
        )
        if response.status_code >= 500 or response.status_code in {408, 429}:
            raise PushoverDeliveryError(error_code="pushover_provider_retryable", retryable=True)
        if response.status_code >= 400:
            raise PushoverDeliveryError(
                error_code="pushover_provider_rejected",
                retryable=False,
                invalid_user_key=response.status_code == 400,
            )
        try:
            body = response.json()
        except ValueError as exc:
            raise PushoverDeliveryError(
                error_code="pushover_provider_invalid_json", retryable=False
            ) from exc
        if not isinstance(body, dict) or body.get("status") != 1:
            errors = body.get("errors") if isinstance(body, dict) else None
            invalid_key = isinstance(errors, list) and any(
                "user" in str(item).lower() for item in errors
            )
            raise PushoverDeliveryError(
                error_code="pushover_provider_rejected",
                retryable=False,
                invalid_user_key=invalid_key,
            )
        request_id = body.get("request")
        if not isinstance(request_id, str) or not request_id.strip():
            raise PushoverDeliveryError(
                error_code="pushover_provider_missing_request", retryable=False
            )
        return PushoverSendResult(request_id=request_id)

    async def _post(self, path: str, data: dict[str, str | None]) -> httpx.Response:
        timeout = httpx.Timeout(self.settings.pushover_request_timeout_seconds)
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                return await client.post(
                    f"{self.settings.pushover_api_url.rstrip('/')}{path}", data=data
                )
        except httpx.HTTPError as exc:
            raise PushoverDeliveryError(
                error_code="pushover_transport_error", retryable=True
            ) from exc

    @staticmethod
    def _status_success(response: httpx.Response) -> bool:
        try:
            body = response.json()
        except ValueError:
            return False
        return isinstance(body, dict) and body.get("status") == 1


def user_key_hint(user_key: str) -> str:
    return f"••••{user_key[-4:]}" if len(user_key) >= 4 else "••••"
