import pytest
from pydantic import ValidationError

from app.core.settings import Settings, get_settings


def test_settings_fail_closed_when_required_config_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    get_settings.cache_clear()

    with pytest.raises(ValidationError):
        Settings(_env_file=None)
