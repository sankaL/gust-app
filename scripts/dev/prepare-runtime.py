#!/usr/bin/env python3
from __future__ import annotations

import shutil
import socket
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
ROOT_ENV_PATH = ROOT / ".env"
RUNTIME_DIR = ROOT / ".dev-runtime"
SUPABASE_TEMPLATE_DIR = ROOT / "supabase"
SUPABASE_RUNTIME_DIR = RUNTIME_DIR / "supabase"
RUNTIME_ENV_PATH = RUNTIME_DIR / "runtime.env"

PORT_DEFAULTS = {
    "GUST_FRONTEND_PORT": 3000,
    "GUST_BACKEND_PORT": 8000,
    "GUST_SUPABASE_API_PORT": 54321,
    "GUST_SUPABASE_DB_PORT": 54322,
    "GUST_SUPABASE_STUDIO_PORT": 54323,
    "GUST_SUPABASE_MAIL_PORT": 54324,
    "GUST_SUPABASE_SHADOW_PORT": 54320,
    "GUST_SUPABASE_POOLER_PORT": 54329,
}

LOCAL_SUPABASE_ANON_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9."
    "CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
)

LOCAL_ENV_DEFAULTS = {
    "APP_ENV": "development",
    "GUST_DEV_MODE": "true",
    "REQUIRED_ALEMBIC_REVISION": "0008_digest_dispatches",
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
    "SUPABASE_AUTH_EXTERNAL_GOOGLE_ENABLED": "false",
    "SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID": "",
    "SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET": "",
    "VITE_GUST_DEV_MODE": "true",
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
    "SUPABASE_AUTH_EXTERNAL_GOOGLE_ENABLED",
    "SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID",
    "SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET",
    "VITE_GUST_DEV_MODE",
    "VITE_API_BASE_URL",
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
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
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


def render_supabase_config(
    config_template: str,
    ports: dict[str, int],
    runtime_values: dict[str, str | int],
) -> str:
    frontend_url = f"http://localhost:{ports['GUST_FRONTEND_PORT']}"
    backend_callback_url = (
        f"http://localhost:{ports['GUST_BACKEND_PORT']}/auth/session/callback"
    )
    google_enabled = str(
        runtime_values.get("SUPABASE_AUTH_EXTERNAL_GOOGLE_ENABLED", "false")
    ).lower() in {"1", "true", "yes", "on"}

    replacements = {
        "port = 54321": f"port = {ports['GUST_SUPABASE_API_PORT']}",
        "shadow_port = 54320": f"shadow_port = {ports['GUST_SUPABASE_SHADOW_PORT']}",
        "port = 54322": f"port = {ports['GUST_SUPABASE_DB_PORT']}",
        "port = 54329": f"port = {ports['GUST_SUPABASE_POOLER_PORT']}",
        "port = 54323": f"port = {ports['GUST_SUPABASE_STUDIO_PORT']}",
        "port = 54324": f"port = {ports['GUST_SUPABASE_MAIL_PORT']}",
        'site_url = "http://localhost:3000"': f'site_url = "{frontend_url}"',
        'additional_redirect_urls = ["http://localhost:3000"]': (
            f'additional_redirect_urls = ["{frontend_url}", "{backend_callback_url}"]'
        ),
    }

    rendered = config_template
    for needle, replacement in replacements.items():
        rendered = rendered.replace(needle, replacement)

    google_section_pattern = re.compile(
        r"(^\[auth\.external\.google\]\s*$.*?^\s*enabled\s*=\s*)(?:true|false)\s*$",
        re.MULTILINE | re.DOTALL,
    )
    rendered, google_updates = google_section_pattern.subn(
        lambda match: f"{match.group(1)}{'true' if google_enabled else 'false'}",
        rendered,
        count=1,
    )
    if google_updates != 1:
        raise RuntimeError("Could not set auth.external.google.enabled in Supabase config.")

    return rendered


def resolve_ports(existing_values: dict[str, str]) -> dict[str, int]:
    if all(key in existing_values for key in PORT_DEFAULTS):
        return {key: int(existing_values[key]) for key in PORT_DEFAULTS}

    reserved: set[int] = set()
    return {
        key: choose_port(default_port, reserved)
        for key, default_port in PORT_DEFAULTS.items()
    }


def build_runtime_values(
    env_values: dict[str, str],
    ports: dict[str, int],
    *,
    supabase_anon_key: str,
) -> dict[str, str | int]:
    frontend_url = f"http://localhost:{ports['GUST_FRONTEND_PORT']}"
    backend_url = f"http://localhost:{ports['GUST_BACKEND_PORT']}"

    runtime_values: dict[str, str | int] = {
        **ports,
        "DATABASE_URL": (
            "postgresql+psycopg://postgres:postgres@host.docker.internal:"
            f"{ports['GUST_SUPABASE_DB_PORT']}/postgres"
        ),
        "FRONTEND_APP_URL": frontend_url,
        "BACKEND_PUBLIC_URL": backend_url,
        "SUPABASE_URL": f"http://host.docker.internal:{ports['GUST_SUPABASE_API_PORT']}",
        "SUPABASE_ANON_KEY": supabase_anon_key,
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
    SUPABASE_RUNTIME_DIR.mkdir(parents=True, exist_ok=True)

    root_env_values = parse_env_file(ROOT_ENV_PATH)
    existing_runtime_values = parse_env_file(RUNTIME_ENV_PATH)
    ports = resolve_ports(existing_runtime_values)
    supabase_anon_key = (
        existing_runtime_values.get("SUPABASE_ANON_KEY")
        or existing_runtime_values.get("GUST_SUPABASE_ANON_KEY")
        or LOCAL_SUPABASE_ANON_KEY
    )
    runtime_values = build_runtime_values(
        root_env_values,
        ports,
        supabase_anon_key=supabase_anon_key,
    )
    write_runtime_env(runtime_values)
    shutil.copy2(SUPABASE_TEMPLATE_DIR / "seed.sql", SUPABASE_RUNTIME_DIR / "seed.sql")

    config_template = (SUPABASE_TEMPLATE_DIR / "config.toml").read_text(encoding="utf-8")
    rendered_config = render_supabase_config(config_template, ports, runtime_values)
    (SUPABASE_RUNTIME_DIR / "config.toml").write_text(rendered_config, encoding="utf-8")


if __name__ == "__main__":
    main()
