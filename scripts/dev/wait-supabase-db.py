#!/usr/bin/env python3
from __future__ import annotations

import socket
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
RUNTIME_ENV_PATH = ROOT / ".dev-runtime" / "runtime.env"
TIMEOUT_SECONDS = 60


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


def can_connect(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=1):
            return True
    except OSError:
        return False


def main() -> int:
    runtime_values = parse_env_file(RUNTIME_ENV_PATH)
    raw_port = runtime_values.get("GUST_SUPABASE_DB_PORT")
    if raw_port is None:
        print(f"Missing GUST_SUPABASE_DB_PORT in {RUNTIME_ENV_PATH}", file=sys.stderr)
        return 1

    port = int(raw_port)
    deadline = time.monotonic() + TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if can_connect(port):
            print(f"Supabase Postgres is reachable on 127.0.0.1:{port}.")
            return 0
        time.sleep(1)

    print(
        f"Supabase Postgres did not become reachable on 127.0.0.1:{port} "
        f"within {TIMEOUT_SECONDS} seconds.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
