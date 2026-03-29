import pytest
from pydantic import ValidationError

from app.core.settings import Settings, get_settings


def test_settings_fail_closed_when_required_config_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("MIGRATION_DATABASE_URL", raising=False)
    get_settings.cache_clear()

    with pytest.raises(ValidationError):
        Settings(_env_file=None)


def test_alembic_database_url_defaults_to_runtime_database_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("DATABASE_URL", "sqlite+pysqlite:///:memory:")
    monkeypatch.delenv("MIGRATION_DATABASE_URL", raising=False)

    settings = Settings(_env_file=None)

    assert settings.alembic_database_url == "sqlite+pysqlite:///:memory:"


def test_alembic_database_url_prefers_migration_database_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://runtime@db/runtime")
    monkeypatch.setenv("MIGRATION_DATABASE_URL", "postgresql+psycopg://admin@db/admin")

    settings = Settings(_env_file=None)

    assert settings.alembic_database_url == "postgresql+psycopg://admin@db/admin"
