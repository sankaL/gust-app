from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient

from app.core.app import create_app
from app.core.settings import get_settings


@pytest.fixture(autouse=True)
def clear_settings_cache() -> Generator[None, None, None]:
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> Generator[TestClient, None, None]:
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("DATABASE_URL", "sqlite+pysqlite:///:memory:")
    monkeypatch.setenv("RUN_STARTUP_CHECKS", "false")

    test_app = create_app()

    with TestClient(test_app) as test_client:
        yield test_client
