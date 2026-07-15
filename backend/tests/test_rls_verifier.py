from __future__ import annotations

import importlib.util
from pathlib import Path

import psycopg


def _load_verifier_module():
    script_path = (
        Path(__file__).resolve().parents[2] / "scripts" / "prod" / "check-postgres-rls.py"
    )
    spec = importlib.util.spec_from_file_location("check_postgres_rls", script_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_verifier_normalizes_sqlalchemy_psycopg_url() -> None:
    module = _load_verifier_module()

    assert module._psycopg_database_url(
        "postgresql+psycopg://user:password@example.test/database"
    ) == "postgresql://user:password@example.test/database"


def test_verifier_sanitizes_database_errors(monkeypatch, capsys) -> None:
    module = _load_verifier_module()
    monkeypatch.setattr(
        module,
        "main",
        lambda: (_ for _ in ()).throw(
            psycopg.OperationalError("postgresql://user:secret@example.test/database")
        ),
    )

    assert module._run_main() == 1
    stderr = capsys.readouterr().err
    assert "database verification failed" in stderr
    assert "secret" not in stderr
