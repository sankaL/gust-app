import pytest
from pydantic import ValidationError

from app.core.request_security import trusted_hosts
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


def test_extraction_model_defaults_to_gemini_3_7_flash(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("DATABASE_URL", "sqlite+pysqlite:///:memory:")
    monkeypatch.delenv("OPENROUTER_EXTRACTION_MODEL", raising=False)

    settings = Settings(_env_file=None)

    assert settings.openrouter_extraction_model == "google/gemini-3.7-flash"


def test_settings_reject_production_dev_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("GUST_DEV_MODE", "true")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://runtime@db/runtime")

    with pytest.raises(ValidationError, match="GUST_DEV_MODE must be disabled"):
        Settings(_env_file=None)


def test_trusted_hosts_include_railway_runtime_domains(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://runtime@db/runtime")
    monkeypatch.setenv("FRONTEND_APP_URL", "https://gustapp.ca")
    monkeypatch.setenv("BACKEND_PUBLIC_URL", "https://api.gustapp.ca")
    monkeypatch.setenv("RAILWAY_PRIVATE_DOMAIN", "backend.railway.internal")
    monkeypatch.setenv("RAILWAY_PUBLIC_DOMAIN", "backend-production.up.railway.app")
    monkeypatch.setenv(
        "RAILWAY_SERVICE_BACKEND_URL",
        "https://backend-production-496e.up.railway.app",
    )

    settings = Settings(_env_file=None)

    hosts = trusted_hosts(settings)

    assert "backend.railway.internal" in hosts
    assert "backend-production.up.railway.app" in hosts
    assert "backend-production-496e.up.railway.app" in hosts
    assert "healthcheck.railway.app" in hosts
    assert "*.railway.internal" in hosts
    assert "*.up.railway.app" in hosts
    assert "*" not in hosts
