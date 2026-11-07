import sqlite3
from collections.abc import Generator
from datetime import date, datetime

import pytest
from starlette.testclient import TestClient

from app.core.app import create_app
from app.core.settings import get_settings
from app.db.engine import build_engine
from app.db.schema import allowed_users, metadata


def _adapt_sqlite_date(value: date) -> str:
    return value.isoformat()


def _adapt_sqlite_datetime(value: datetime) -> str:
    return value.isoformat(" ")


# Python 3.12 deprecated sqlite3's implicit adapters. Keep test-database
# serialization explicit so the suite exercises the future runtime behavior.
sqlite3.register_adapter(date, _adapt_sqlite_date)
sqlite3.register_adapter(datetime, _adapt_sqlite_datetime)


@pytest.fixture(autouse=True)
def clear_settings_cache() -> Generator[None, None, None]:
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture()
def app_factory(monkeypatch: pytest.MonkeyPatch, tmp_path) -> Generator:
    """Build a test app; extra env vars apply before the app reads its settings."""
    built: list = []

    def build(extra_env: dict[str, str] | None = None):
        database_path = tmp_path / "gust-test.db"
        monkeypatch.setenv("APP_ENV", "test")
        monkeypatch.setenv("GUST_DEV_MODE", "false")
        monkeypatch.setenv("DATABASE_URL", f"sqlite+pysqlite:///{database_path}")
        monkeypatch.setenv("RUN_STARTUP_CHECKS", "false")
        monkeypatch.setenv("FRONTEND_APP_URL", "http://frontend.test")
        monkeypatch.setenv("BACKEND_PUBLIC_URL", "http://testserver")
        monkeypatch.setenv("SUPABASE_URL", "http://supabase.test")
        monkeypatch.setenv("SUPABASE_ANON_KEY", "test-anon-key")
        monkeypatch.setenv("SESSION_COOKIE_SECURE", "false")
        for key, value in (extra_env or {}).items():
            monkeypatch.setenv(key, value)
        get_settings.cache_clear()

        engine = build_engine(f"sqlite+pysqlite:///{database_path}")
        metadata.create_all(engine)
        with engine.begin() as connection:
            connection.execute(
                allowed_users.insert().prefix_with("OR IGNORE"),
                [
                    {"email": "user@example.com"},
                    {"email": "other@example.com"},
                    {"email": "local-dev@gust.local"},
                ],
            )
        engine.dispose()

        test_app = create_app()
        built.append(test_app)
        return test_app

    yield build
    for test_app in built:
        test_app.dependency_overrides.clear()


@pytest.fixture()
def app(app_factory) -> Generator:
    yield app_factory()


@pytest.fixture()
def client(app) -> Generator[TestClient, None, None]:
    test_app = app
    with TestClient(test_app, follow_redirects=False) as test_client:
        yield test_client
