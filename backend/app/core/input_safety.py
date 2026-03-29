from __future__ import annotations

import os
import unicodedata

MAX_TRANSCRIPT_CHARS = 20_000
MAX_TITLE_CHARS = 200
MAX_TASK_DESCRIPTION_CHARS = 2_000
MAX_GROUP_DESCRIPTION_CHARS = 500
MAX_FILENAME_CHARS = 255
MAX_LOG_VALUE_CHARS = 120
DEFAULT_MAX_AUDIO_UPLOAD_BYTES = 10 * 1024 * 1024

DEFAULT_ALLOWED_AUDIO_CONTENT_TYPES: tuple[str, ...] = (
    "audio/webm",
    "audio/mp4",
    "audio/mpeg",
    "audio/wav",
    "audio/x-wav",
    "audio/ogg",
)

_ALLOWED_CONTROL_CHARS = {"\n", "\r", "\t"}


def validate_plain_text(value: str, *, field_name: str, max_length: int) -> str:
    cleaned = _reject_unsafe_characters(value, field_name=field_name)
    normalized = " ".join(cleaned.strip().split())
    if len(normalized) > max_length:
        raise ValueError(f"{field_name} must be at most {max_length} characters.")
    return normalized


def validate_optional_plain_text(
    value: str | None,
    *,
    field_name: str,
    max_length: int,
) -> str | None:
    if value is None:
        return None
    normalized = validate_plain_text(value, field_name=field_name, max_length=max_length)
    return normalized or None


def validate_multiline_text(value: str, *, field_name: str, max_length: int) -> str:
    cleaned = _reject_unsafe_characters(value, field_name=field_name)
    normalized = cleaned.replace("\r\n", "\n").replace("\r", "\n").strip()
    if len(normalized) > max_length:
        raise ValueError(f"{field_name} must be at most {max_length} characters.")
    return normalized


def validate_optional_multiline_text(
    value: str | None,
    *,
    field_name: str,
    max_length: int,
) -> str | None:
    if value is None:
        return None
    normalized = validate_multiline_text(value, field_name=field_name, max_length=max_length)
    return normalized or None


def sanitize_for_log(value: str | None, *, max_length: int = MAX_LOG_VALUE_CHARS) -> str | None:
    if value is None:
        return None

    characters: list[str] = []
    for character in value:
        if _is_disallowed_control(character):
            characters.append("?")
        elif character in _ALLOWED_CONTROL_CHARS:
            characters.append(" ")
        else:
            characters.append(character)

    normalized = " ".join("".join(characters).strip().split())
    if len(normalized) <= max_length:
        return normalized
    return f"{normalized[: max_length - 3]}..."


def validate_audio_content_type(
    content_type: str,
    *,
    allowed_content_types: tuple[str, ...],
) -> str:
    normalized = sanitize_for_log(content_type, max_length=80)
    if normalized is not None:
        normalized = normalized.split(";", maxsplit=1)[0].strip().lower()
    if normalized is None or normalized not in allowed_content_types:
        raise ValueError("Uploaded file must be a supported audio type.")
    return normalized


def validate_audio_size(audio_bytes: bytes, *, max_bytes: int) -> None:
    if not audio_bytes:
        raise ValueError("Audio upload cannot be empty.")
    if len(audio_bytes) > max_bytes:
        raise ValueError(f"Audio upload must be at most {max_bytes} bytes.")


def validate_upload_filename(filename: str) -> str:
    cleaned = _reject_unsafe_characters(filename, field_name="filename").strip()
    if not cleaned:
        raise ValueError("Uploaded file name is invalid.")
    if len(cleaned) > MAX_FILENAME_CHARS:
        raise ValueError("Uploaded file name is invalid.")
    if cleaned != os.path.basename(cleaned):
        raise ValueError("Uploaded file name is invalid.")
    if ".." in cleaned or "/" in cleaned or "\\" in cleaned:
        raise ValueError("Uploaded file name is invalid.")
    return cleaned


def _reject_unsafe_characters(value: str, *, field_name: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field_name} must be a string.")

    for character in value:
        if character == "\x00" or _is_disallowed_control(character):
            raise ValueError(f"{field_name} contains unsupported control characters.")
    return unicodedata.normalize("NFKC", value)


def _is_disallowed_control(character: str) -> bool:
    return unicodedata.category(character) == "Cc" and character not in _ALLOWED_CONTROL_CHARS
