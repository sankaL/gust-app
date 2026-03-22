from functools import lru_cache
from typing import Optional

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
        default="0003_phase2_capture_extraction",
        validation_alias=AliasChoices("REQUIRED_ALEMBIC_REVISION"),
    )
    run_startup_checks: bool = Field(
        default=True,
        validation_alias=AliasChoices("RUN_STARTUP_CHECKS"),
    )
    log_level: str = Field(default="INFO", validation_alias=AliasChoices("LOG_LEVEL"))
    frontend_app_url: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("FRONTEND_APP_URL"),
    )
    backend_public_url: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("BACKEND_PUBLIC_URL"),
    )
    supabase_url: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("SUPABASE_URL"),
    )
    supabase_anon_key: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("SUPABASE_ANON_KEY"),
    )
    session_cookie_secure: bool = Field(
        default=True,
        validation_alias=AliasChoices("SESSION_COOKIE_SECURE"),
    )
    session_cookie_domain: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("SESSION_COOKIE_DOMAIN"),
    )
    capture_retention_days: int = Field(
        default=7,
        validation_alias=AliasChoices("CAPTURE_RETENTION_DAYS"),
    )
    mistral_api_url: str = Field(
        default="https://api.mistral.ai/v1/audio/transcriptions",
        validation_alias=AliasChoices("MISTRAL_API_URL"),
    )
    mistral_api_key: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("MISTRAL_API_KEY"),
    )
    mistral_transcription_model: str = Field(
        default="voxtral-mini-latest",
        validation_alias=AliasChoices("MISTRAL_TRANSCRIPTION_MODEL"),
    )
    transcription_timeout_seconds: float = Field(
        default=20.0,
        validation_alias=AliasChoices("TRANSCRIPTION_TIMEOUT_SECONDS"),
    )
    openrouter_api_url: str = Field(
        default="https://openrouter.ai/api/v1/chat/completions",
        validation_alias=AliasChoices("OPENROUTER_API_URL"),
    )
    openrouter_api_key: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("OPENROUTER_API_KEY"),
    )
    openrouter_extraction_model: str = Field(
        default="openai/gpt-4.1-mini",
        validation_alias=AliasChoices("OPENROUTER_EXTRACTION_MODEL"),
    )
    extraction_timeout_seconds: float = Field(
        default=20.0,
        validation_alias=AliasChoices("EXTRACTION_TIMEOUT_SECONDS"),
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
