from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: str = Field(validation_alias=AliasChoices("APP_ENV"))
    gust_dev_mode: bool = Field(
        default=False,
        validation_alias=AliasChoices("GUST_DEV_MODE"),
    )
    database_url: str = Field(validation_alias=AliasChoices("DATABASE_URL"))
    required_alembic_revision: str = Field(
        default="0001_phase0_baseline",
        validation_alias=AliasChoices("REQUIRED_ALEMBIC_REVISION"),
    )
    run_startup_checks: bool = Field(
        default=True,
        validation_alias=AliasChoices("RUN_STARTUP_CHECKS"),
    )
    log_level: str = Field(default="INFO", validation_alias=AliasChoices("LOG_LEVEL"))


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
