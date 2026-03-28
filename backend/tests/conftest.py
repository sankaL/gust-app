from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient

from app.core.app import create_app
from app.core.settings import get_settings
from app.db.engine import build_engine
from app.db.schema import allowed_users, metadata


@pytest.fixture(autouse=True)
def clear_settings_cache() -> Generator[None, None, None]:
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture()
def app(monkeypatch: pytest.MonkeyPatch, tmp_path) -> Generator:
    database_path = tmp_path / "gust-test.db"
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("DATABASE_URL", f"sqlite+pysqlite:///{database_path}")
    monkeypatch.setenv("RUN_STARTUP_CHECKS", "false")
    monkeypatch.setenv("FRONTEND_APP_URL", "http://frontend.test")
    monkeypatch.setenv("BACKEND_PUBLIC_URL", "http://testserver")
    monkeypatch.setenv("SUPABASE_URL", "http://supabase.test")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "test-anon-key")
    monkeypatch.setenv("SESSION_COOKIE_SECURE", "false")

    engine = build_engine(f"sqlite+pysqlite:///{database_path}")
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(
            allowed_users.insert(),
            [
                {"email": "user@example.com"},
                {"email": "other@example.com"},
                {"email": "local-dev@gust.local"},
            ],
        )
    engine.dispose()

    test_app = create_app()
    yield test_app
    test_app.dependency_overrides.clear()


@pytest.fixture()
def client(app) -> Generator[TestClient, None, None]:
    test_app = app
    with TestClient(test_app, follow_redirects=False) as test_client:
        yield test_client
