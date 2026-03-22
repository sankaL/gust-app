#!/usr/bin/env python3
from __future__ import annotations

import shutil
import socket
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
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


def render_supabase_config(config_template: str, ports: dict[str, int]) -> str:
    frontend_url = f"http://localhost:{ports['GUST_FRONTEND_PORT']}"

    replacements = {
        "port = 54321": f"port = {ports['GUST_SUPABASE_API_PORT']}",
        "shadow_port = 54320": f"shadow_port = {ports['GUST_SUPABASE_SHADOW_PORT']}",
        "port = 54322": f"port = {ports['GUST_SUPABASE_DB_PORT']}",
        "port = 54329": f"port = {ports['GUST_SUPABASE_POOLER_PORT']}",
        "port = 54323": f"port = {ports['GUST_SUPABASE_STUDIO_PORT']}",
        "port = 54324": f"port = {ports['GUST_SUPABASE_MAIL_PORT']}",
        'site_url = "http://localhost:3000"': f'site_url = "{frontend_url}"',
        'additional_redirect_urls = ["http://localhost:3000"]': (
            f'additional_redirect_urls = ["{frontend_url}"]'
        ),
    }

    rendered = config_template
    for needle, replacement in replacements.items():
        rendered = rendered.replace(needle, replacement)

    return rendered


def write_runtime_env(ports: dict[str, int]) -> None:
    lines = [f"{key}={value}" for key, value in sorted(ports.items())]
    RUNTIME_ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    existing_files = (
        RUNTIME_ENV_PATH,
        SUPABASE_RUNTIME_DIR / "config.toml",
        SUPABASE_RUNTIME_DIR / "seed.sql",
    )
    if all(path.exists() for path in existing_files):
        return

    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    SUPABASE_RUNTIME_DIR.mkdir(parents=True, exist_ok=True)

    reserved: set[int] = set()
    ports = {
        key: choose_port(default_port, reserved)
        for key, default_port in PORT_DEFAULTS.items()
    }

    write_runtime_env(ports)

    shutil.copy2(SUPABASE_TEMPLATE_DIR / "seed.sql", SUPABASE_RUNTIME_DIR / "seed.sql")

    config_template = (SUPABASE_TEMPLATE_DIR / "config.toml").read_text(encoding="utf-8")
    rendered_config = render_supabase_config(config_template, ports)
    (SUPABASE_RUNTIME_DIR / "config.toml").write_text(rendered_config, encoding="utf-8")


if __name__ == "__main__":
    main()
