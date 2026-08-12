from __future__ import annotations

import importlib.util
from pathlib import Path
from types import SimpleNamespace

import pytest


@pytest.fixture
def prepare_runtime_module():
    script_path = Path(__file__).resolve().parents[2] / "scripts" / "dev" / "prepare-runtime.py"
    spec = importlib.util.spec_from_file_location("prepare_runtime", script_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_resolve_ports_reuses_available_existing_port(
    prepare_runtime_module,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(prepare_runtime_module, "port_is_available", lambda _port: True)

    ports = prepare_runtime_module.resolve_ports({"GUST_FRONTEND_PORT": "3100"})

    assert ports["GUST_FRONTEND_PORT"] == 3100


def test_resolve_ports_preserves_compose_owned_occupied_port(
    prepare_runtime_module,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        prepare_runtime_module,
        "port_is_available",
        lambda port: port != 3100,
    )

    ports = prepare_runtime_module.resolve_ports(
        {"GUST_FRONTEND_PORT": "3100"},
        compose_owned_ports={3100},
    )

    assert ports["GUST_FRONTEND_PORT"] == 3100


def test_resolve_ports_replaces_foreign_occupied_existing_port(
    prepare_runtime_module,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        prepare_runtime_module,
        "port_is_available",
        lambda port: port != 3100,
    )

    ports = prepare_runtime_module.resolve_ports({"GUST_FRONTEND_PORT": "3100"})

    assert ports["GUST_FRONTEND_PORT"] == 3000


def test_get_compose_owned_ports_reads_published_host_ports(
    prepare_runtime_module,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    runtime_env = tmp_path / "runtime.env"
    runtime_env.write_text("GUST_FRONTEND_PORT=3100\n", encoding="utf-8")
    monkeypatch.setattr(prepare_runtime_module, "RUNTIME_ENV_PATH", runtime_env)
    monkeypatch.setattr(
        prepare_runtime_module.subprocess,
        "run",
        lambda *_args, **_kwargs: SimpleNamespace(
            returncode=0,
            stdout="0.0.0.0:3100\n[::]:3100\n",
        ),
    )

    assert prepare_runtime_module.get_compose_owned_ports() == {3100}
