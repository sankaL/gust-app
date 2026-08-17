from __future__ import annotations

import asyncio

import httpx
import pytest
from cryptography.fernet import Fernet

from app.services.pushover import PushoverDeliveryError, PushoverService


def _configured_service(client) -> PushoverService:
    settings = client.app.state.settings
    settings.pushover_notifications_enabled = True
    settings.pushover_app_token = "a" * 30
    settings.pushover_credential_encryption_key = Fernet.generate_key().decode()
    return PushoverService(settings)


def test_send_adds_html_flag_without_slicing_message(client, monkeypatch) -> None:
    service = _configured_service(client)
    captured: dict[str, object] = {}

    async def fake_post(path: str, data: dict[str, str | None]) -> httpx.Response:
        captured.update({"path": path, "data": data})
        return httpx.Response(200, json={"status": 1, "request": "request-id"})

    monkeypatch.setattr(service, "_post", fake_post)
    message = "<b>TASK PREVIEW</b>\n\nTask title"

    result = asyncio.run(
        service.send(
            user_key="b" * 30,
            title="Gust task reminder",
            message=message,
            url="https://gustapp.ca/tasks?group=all&task=123",
            ttl_seconds=3600,
            html_enabled=True,
        )
    )

    assert result.request_id == "request-id"
    assert captured["path"] == "/messages.json"
    payload = captured["data"]
    assert isinstance(payload, dict)
    assert payload["message"] == message
    assert payload["html"] == "1"


def test_send_rejects_oversized_message_before_delivery(client, monkeypatch) -> None:
    service = _configured_service(client)
    post_called = False

    async def fake_post(path: str, data: dict[str, str | None]) -> httpx.Response:
        nonlocal post_called
        del path, data
        post_called = True
        return httpx.Response(200, json={"status": 1, "request": "request-id"})

    monkeypatch.setattr(service, "_post", fake_post)

    with pytest.raises(PushoverDeliveryError) as raised:
        asyncio.run(
            service.send(
                user_key="b" * 30,
                title="Gust",
                message="x" * 1025,
                url="https://gustapp.ca/tasks",
                ttl_seconds=3600,
                html_enabled=False,
            )
        )

    assert raised.value.error_code == "pushover_message_too_long"
    assert raised.value.retryable is False
    assert post_called is False
