from __future__ import annotations

import uuid

import pytest
import sqlalchemy as sa
from cryptography.fernet import Fernet

from app.core.errors import ConfigurationError
from app.db.engine import connection_scope
from app.db.schema import notification_preferences, users
from app.ops.rotate_pushover_credentials import rotate_pushover_credentials
from app.services.pushover import PushoverDeliveryError, PushoverService


def _seed(settings, encrypted_values: list[str | None]) -> list[str]:
    user_ids = []
    with connection_scope(settings.database_url) as connection:
        for index, encrypted in enumerate(encrypted_values):
            user_id = str(uuid.uuid4())
            user_ids.append(user_id)
            connection.execute(
                users.insert().values(id=user_id, email=f"u{index}@example.com", timezone="UTC")
            )
            connection.execute(
                notification_preferences.insert().values(
                    user_id=user_id, pushover_user_key_encrypted=encrypted
                )
            )
    return user_ids


def _stored(settings) -> dict[str, str | None]:
    with connection_scope(settings.database_url) as connection:
        rows = connection.execute(
            sa.select(
                notification_preferences.c.user_id,
                notification_preferences.c.pushover_user_key_encrypted,
            )
        ).all()
    return {str(row.user_id): row.pushover_user_key_encrypted for row in rows}


def _configure(settings, *, current: str, previous: tuple[str, ...]) -> None:
    settings.pushover_notifications_enabled = True
    settings.pushover_app_token = "a" * 30
    settings.pushover_credential_encryption_key = current
    settings.pushover_previous_credential_encryption_keys = previous


def test_service_decrypts_with_previous_key_and_encrypts_with_current(client) -> None:
    settings = client.app.state.settings
    old_key, new_key = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    old_token = Fernet(old_key.encode()).encrypt(b"user-key-old").decode()
    _configure(settings, current=new_key, previous=(old_key,))
    service = PushoverService(settings)

    assert service.decrypt_user_key(old_token) == "user-key-old"
    fresh = service.encrypt_user_key("user-key-new")
    assert Fernet(new_key.encode()).decrypt(fresh.encode()) == b"user-key-new"

    settings.pushover_previous_credential_encryption_keys = ()
    with pytest.raises(PushoverDeliveryError):
        service.decrypt_user_key(old_token)


def test_dry_run_reports_without_writing(client) -> None:
    settings = client.app.state.settings
    old_key, new_key = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    old_token = Fernet(old_key.encode()).encrypt(b"k1").decode()
    _seed(settings, [old_token, None])
    _configure(settings, current=new_key, previous=(old_key,))
    before = _stored(settings)

    result = rotate_pushover_credentials(settings, apply=False)

    assert (result.scanned, result.rotated, result.applied) == (1, 1, False)
    assert _stored(settings) == before


def test_apply_reencrypts_old_rows_and_skips_current_ones(client) -> None:
    settings = client.app.state.settings
    old_key, new_key = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    old_token = Fernet(old_key.encode()).encrypt(b"k-old").decode()
    current_token = Fernet(new_key.encode()).encrypt(b"k-current").decode()
    old_user, current_user, _ = _seed(settings, [old_token, current_token, None])
    _configure(settings, current=new_key, previous=(old_key,))

    result = rotate_pushover_credentials(settings, apply=True)

    assert result.applied is True
    assert (result.scanned, result.already_current, result.rotated) == (2, 1, 1)
    stored = _stored(settings)
    assert stored[current_user] == current_token
    assert Fernet(new_key.encode()).decrypt(stored[old_user].encode()) == b"k-old"

    # Once rotated, the previous key is no longer needed.
    settings.pushover_previous_credential_encryption_keys = ()
    assert PushoverService(settings).decrypt_user_key(stored[old_user]) == "k-old"


def test_apply_fails_closed_when_any_row_is_undecryptable(client) -> None:
    settings = client.app.state.settings
    old_key, new_key, unknown_key = (Fernet.generate_key().decode() for _ in range(3))
    old_token = Fernet(old_key.encode()).encrypt(b"k1").decode()
    stray_token = Fernet(unknown_key.encode()).encrypt(b"k2").decode()
    _, stray_user = _seed(settings, [old_token, stray_token])
    _configure(settings, current=new_key, previous=(old_key,))
    before = _stored(settings)

    result = rotate_pushover_credentials(settings, apply=True)

    assert result.applied is False
    assert result.undecryptable_user_ids == [stray_user]
    assert _stored(settings) == before


def test_refuses_to_run_without_previous_keys(client) -> None:
    settings = client.app.state.settings
    _configure(settings, current=Fernet.generate_key().decode(), previous=())

    with pytest.raises(ConfigurationError):
        rotate_pushover_credentials(settings, apply=True)


def test_previous_keys_setting_parses_csv(monkeypatch) -> None:
    from app.core.settings import Settings

    first, second = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    monkeypatch.setenv("DATABASE_URL", "sqlite+pysqlite:///:memory:")
    monkeypatch.setenv("PUSHOVER_PREVIOUS_CREDENTIAL_ENCRYPTION_KEYS", f"{first}, {second}")

    assert Settings().pushover_previous_credential_encryption_keys == (first, second)
