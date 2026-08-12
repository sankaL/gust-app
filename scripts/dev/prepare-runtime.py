#!/usr/bin/env python3
from __future__ import annotations

import socket
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
ROOT_ENV_PATH = ROOT / ".env"
RUNTIME_DIR = ROOT / ".dev-runtime"
RUNTIME_ENV_PATH = RUNTIME_DIR / "runtime.env"

PORT_DEFAULTS = {
    "GUST_FRONTEND_PORT": 3000,
    "GUST_BACKEND_PORT": 8000,
    "GUST_POSTGRES_PORT": 5432,
}

LOCAL_ENV_DEFAULTS = {
    "APP_ENV": "development",
    "GUST_DEV_MODE": "true",
    "REQUIRED_ALEMBIC_REVISION": "0018_ensure_allowed_users",
    "RUN_STARTUP_CHECKS": "true",
    "LOG_LEVEL": "INFO",
    "SESSION_COOKIE_SECURE": "false",
    "SESSION_COOKIE_DOMAIN": "",
    "CAPTURE_RETENTION_DAYS": "7",
    "MISTRAL_API_URL": "https://api.mistral.ai/v1/audio/transcriptions",
    "MISTRAL_API_KEY": "",
    "MISTRAL_TRANSCRIPTION_MODEL": "voxtral-mini-latest",
    "TRANSCRIPTION_TIMEOUT_SECONDS": "20",
    "OPENROUTER_API_URL": "https://openrouter.ai/api/v1/chat/completions",
    "OPENROUTER_API_KEY": "",
    "OPENROUTER_EXTRACTION_MODEL": "google/gemini-3-flash-preview",
    "EXTRACTION_TIMEOUT_SECONDS": "20",
    "RESEND_API_URL": "https://api.resend.com/emails",
    "RESEND_API_KEY": "",
    "RESEND_FROM_EMAIL": "",
    "INTERNAL_JOB_SHARED_SECRET": "",
    "REMINDER_BATCH_SIZE": "50",
    "REMINDER_CLAIM_TIMEOUT_SECONDS": "600",
    "REMINDER_REQUEST_TIMEOUT_SECONDS": "10",
    "VITE_GUST_DEV_MODE": "true",
    "VITE_ADMIN_EMAIL": "sanka.lokuliyana@gmail.com",
}

RUNTIME_KEYS = (
    "APP_ENV",
    "GUST_DEV_MODE",
    "DATABASE_URL",
    "REQUIRED_ALEMBIC_REVISION",
    "RUN_STARTUP_CHECKS",
    "LOG_LEVEL",
    "FRONTEND_APP_URL",
    "BACKEND_PUBLIC_URL",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "LOCAL_DEV_AUTH_SECRET",
    "SESSION_COOKIE_SECURE",
    "SESSION_COOKIE_DOMAIN",
    "CAPTURE_RETENTION_DAYS",
    "MISTRAL_API_URL",
    "MISTRAL_API_KEY",
    "MISTRAL_TRANSCRIPTION_MODEL",
    "TRANSCRIPTION_TIMEOUT_SECONDS",
    "OPENROUTER_API_URL",
    "OPENROUTER_API_KEY",
    "OPENROUTER_EXTRACTION_MODEL",
    "EXTRACTION_TIMEOUT_SECONDS",
    "RESEND_API_URL",
    "RESEND_API_KEY",
    "RESEND_FROM_EMAIL",
    "INTERNAL_JOB_SHARED_SECRET",
    "REMINDER_BATCH_SIZE",
    "REMINDER_CLAIM_TIMEOUT_SECONDS",
    "REMINDER_REQUEST_TIMEOUT_SECONDS",
    "VITE_GUST_DEV_MODE",
    "VITE_API_BASE_URL",
    "VITE_ADMIN_EMAIL",
)


def parse_env_file(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}

    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("'").strip('"')
    return values


def port_is_available(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def choose_port(default_port: int, reserved: set[int]) -> int:
    if default_port not in reserved and port_is_available(default_port):
        reserved.add(default_port)
        return default_port

    while True:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            candidate = int(sock.getsockname()[1])
        if candidate in reserved:
            continue
        if not port_is_available(candidate):
            continue
        reserved.add(candidate)
        return candidate


def resolve_ports(existing_values: dict[str, str]) -> dict[str, int]:
    """Return ports, keeping an existing runtime stable across repeated starts."""
    reserved: set[int] = set()
    resolved: dict[str, int] = {}

    for key, default_port in PORT_DEFAULTS.items():
        existing = existing_values.get(key)
        if existing is not None:
            try:
                candidate = int(existing)
            except ValueError:
                candidate = default_port
            # Preserve an established runtime even while its own containers occupy the
            # ports. Availability is only relevant when selecting a port for the first
            # time; reallocation during a restart would desynchronize service URLs.
            if candidate not in reserved:
                reserved.add(candidate)
                resolved[key] = candidate
                continue
        resolved[key] = choose_port(default_port, reserved)

    return resolved


def build_runtime_values(
    env_values: dict[str, str],
    ports: dict[str, int],
) -> dict[str, str | int]:
    frontend_url = f"http://localhost:{ports['GUST_FRONTEND_PORT']}"
    backend_url = f"http://localhost:{ports['GUST_BACKEND_PORT']}"

    runtime_values: dict[str, str | int] = {
        **ports,
        "DATABASE_URL": (
            "postgresql+psycopg://postgres:postgres@postgres:5432/postgres"
        ),
        "REQUIRED_ALEMBIC_REVISION": LOCAL_ENV_DEFAULTS["REQUIRED_ALEMBIC_REVISION"],
        "FRONTEND_APP_URL": frontend_url,
        "BACKEND_PUBLIC_URL": backend_url,
        "SUPABASE_URL": "",
        "SUPABASE_ANON_KEY": "",
        "VITE_API_BASE_URL": backend_url,
    }
    for key in RUNTIME_KEYS:
        if key in runtime_values:
            continue
        runtime_values[key] = env_values.get(key, LOCAL_ENV_DEFAULTS.get(key, ""))
    return runtime_values


def write_runtime_env(runtime_values: dict[str, str | int]) -> None:
    lines = [f"{key}={value}" for key, value in sorted(runtime_values.items())]
    RUNTIME_ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)

    root_env_values = parse_env_file(ROOT_ENV_PATH)
    existing_runtime_values = parse_env_file(RUNTIME_ENV_PATH)
    ports = resolve_ports(existing_runtime_values)
    runtime_values = build_runtime_values(root_env_values, ports)
    write_runtime_env(runtime_values)


if __name__ == "__main__":
    main()
