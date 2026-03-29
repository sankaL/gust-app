from __future__ import annotations

from functools import lru_cache
from typing import Optional

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.input_safety import (
    DEFAULT_ALLOWED_AUDIO_CONTENT_TYPES,
    DEFAULT_MAX_AUDIO_UPLOAD_BYTES,
    MAX_GROUP_DESCRIPTION_CHARS,
    MAX_TASK_DESCRIPTION_CHARS,
    MAX_TITLE_CHARS,
    MAX_TRANSCRIPT_CHARS,
)


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
        default="0011_rate_limit_counters",
        validation_alias=AliasChoices("REQUIRED_ALEMBIC_REVISION"),
    )
    run_startup_checks: bool = Field(
        default=True,
        validation_alias=AliasChoices("RUN_STARTUP_CHECKS"),
    )
    log_level: str = Field(default="INFO", validation_alias=AliasChoices("LOG_LEVEL"))
    enforce_origin_checks: bool = Field(
        default=True,
        validation_alias=AliasChoices("ENFORCE_ORIGIN_CHECKS"),
    )
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
    trusted_hosts: tuple[str, ...] = Field(
        default=(),
        validation_alias=AliasChoices("TRUSTED_HOSTS"),
    )
    extra_allowed_origins: tuple[str, ...] = Field(
        default=(),
        validation_alias=AliasChoices("EXTRA_ALLOWED_ORIGINS"),
    )
    max_transcript_chars: int = Field(
        default=MAX_TRANSCRIPT_CHARS,
        validation_alias=AliasChoices("MAX_TRANSCRIPT_CHARS"),
    )
    max_title_chars: int = Field(
        default=MAX_TITLE_CHARS,
        validation_alias=AliasChoices("MAX_TITLE_CHARS"),
    )
    max_task_description_chars: int = Field(
        default=MAX_TASK_DESCRIPTION_CHARS,
        validation_alias=AliasChoices("MAX_TASK_DESCRIPTION_CHARS"),
    )
    max_group_description_chars: int = Field(
        default=MAX_GROUP_DESCRIPTION_CHARS,
        validation_alias=AliasChoices("MAX_GROUP_DESCRIPTION_CHARS"),
    )
    max_audio_upload_bytes: int = Field(
        default=DEFAULT_MAX_AUDIO_UPLOAD_BYTES,
        validation_alias=AliasChoices("MAX_AUDIO_UPLOAD_BYTES"),
    )
    allowed_audio_content_types: tuple[str, ...] = Field(
        default=DEFAULT_ALLOWED_AUDIO_CONTENT_TYPES,
        validation_alias=AliasChoices("ALLOWED_AUDIO_CONTENT_TYPES"),
    )
    rate_limit_public_get_ip: str = Field(
        default="120/60",
        validation_alias=AliasChoices("RATE_LIMIT_PUBLIC_GET_IP"),
    )
    rate_limit_authenticated_get_user: str = Field(
        default="120/60",
        validation_alias=AliasChoices("RATE_LIMIT_AUTHENTICATED_GET_USER"),
    )
    rate_limit_authenticated_write_user: str = Field(
        default="30/60,300/3600",
        validation_alias=AliasChoices("RATE_LIMIT_AUTHENTICATED_WRITE_USER"),
    )
    rate_limit_auth_entry_ip: str = Field(
        default="10/600,50/3600",
        validation_alias=AliasChoices("RATE_LIMIT_AUTH_ENTRY_IP"),
    )
    rate_limit_capture_voice_user: str = Field(
        default="3/60,12/600,40/86400",
        validation_alias=AliasChoices("RATE_LIMIT_CAPTURE_VOICE_USER"),
    )
    rate_limit_capture_voice_ip: str = Field(
        default="10/600,100/86400",
        validation_alias=AliasChoices("RATE_LIMIT_CAPTURE_VOICE_IP"),
    )
    rate_limit_capture_text_user: str = Field(
        default="6/60,20/600,80/86400",
        validation_alias=AliasChoices("RATE_LIMIT_CAPTURE_TEXT_USER"),
    )
    rate_limit_capture_text_ip: str = Field(
        default="20/600,150/86400",
        validation_alias=AliasChoices("RATE_LIMIT_CAPTURE_TEXT_IP"),
    )
    rate_limit_capture_submit_user: str = Field(
        default="4/60,15/600,60/86400",
        validation_alias=AliasChoices("RATE_LIMIT_CAPTURE_SUBMIT_USER"),
    )
    rate_limit_capture_submit_ip: str = Field(
        default="15/600,120/86400",
        validation_alias=AliasChoices("RATE_LIMIT_CAPTURE_SUBMIT_IP"),
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
        default="google/gemini-3-flash-preview",
        validation_alias=AliasChoices("OPENROUTER_EXTRACTION_MODEL"),
    )
    extraction_timeout_seconds: float = Field(
        default=20.0,
        validation_alias=AliasChoices("EXTRACTION_TIMEOUT_SECONDS"),
    )
    extraction_max_retries: int = Field(
        default=3,
        validation_alias=AliasChoices("EXTRACTION_MAX_RETRIES"),
    )
    extraction_retry_base_delay: float = Field(
        default=1.0,
        validation_alias=AliasChoices("EXTRACTION_RETRY_BASE_DELAY"),
    )
    extraction_retry_max_delay: float = Field(
        default=10.0,
        validation_alias=AliasChoices("EXTRACTION_RETRY_MAX_DELAY"),
    )
    extraction_model_config_path: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("EXTRACTION_MODEL_CONFIG_PATH"),
    )
    extraction_ab_test_enabled: bool = Field(
        default=False,
        validation_alias=AliasChoices("EXTRACTION_AB_TEST_ENABLED"),
    )
    resend_api_url: str = Field(
        default="https://api.resend.com/emails",
        validation_alias=AliasChoices("RESEND_API_URL"),
    )
    resend_api_key: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("RESEND_API_KEY"),
    )
    resend_from_email: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("RESEND_FROM_EMAIL"),
    )
    internal_job_shared_secret: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("INTERNAL_JOB_SHARED_SECRET"),
    )
    reminder_batch_size: int = Field(
        default=50,
        validation_alias=AliasChoices("REMINDER_BATCH_SIZE"),
    )
    reminder_claim_timeout_seconds: int = Field(
        default=600,
        validation_alias=AliasChoices("REMINDER_CLAIM_TIMEOUT_SECONDS"),
    )
    reminder_request_timeout_seconds: float = Field(
        default=10.0,
        validation_alias=AliasChoices("REMINDER_REQUEST_TIMEOUT_SECONDS"),
    )

    @field_validator("trusted_hosts", "extra_allowed_origins", mode="before")
    @classmethod
    def _split_csv_tuple(
        cls,
        value: str | tuple[str, ...] | list[str] | None,
    ) -> tuple[str, ...]:
        if value is None:
            return ()
        if isinstance(value, tuple):
            return tuple(item.strip() for item in value if item and item.strip())
        if isinstance(value, list):
            return tuple(item.strip() for item in value if item and item.strip())
        return tuple(item.strip() for item in value.split(",") if item.strip())

    @field_validator("allowed_audio_content_types", mode="before")
    @classmethod
    def _split_audio_types(
        cls,
        value: str | tuple[str, ...] | list[str] | None,
    ) -> tuple[str, ...]:
        if value is None:
            return DEFAULT_ALLOWED_AUDIO_CONTENT_TYPES
        if isinstance(value, tuple):
            return value
        if isinstance(value, list):
            return tuple(value)
        return tuple(item.strip() for item in value.split(",") if item.strip())


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
