import importlib.util
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect, text

from app.db.migrations import check_required_revision, get_current_revision
from app.db.schema import metadata, tasks


def test_get_current_revision_returns_none_when_alembic_table_is_missing() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")

    with engine.begin() as connection:
        assert get_current_revision(connection) is None


def test_check_required_revision_accepts_matching_revision(tmp_path: Path) -> None:
    database_path = tmp_path / "gust.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    engine = create_engine(database_url)

    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)"))
        connection.execute(
            text(
                "INSERT INTO alembic_version (version_num) "
                "VALUES ('0003_phase2_capture_extraction')"
            )
        )

    check_required_revision(database_url, "0003_phase2_capture_extraction")


def test_schema_metadata_contains_required_tables_and_phase2_reminder_at(tmp_path: Path) -> None:
    database_path = tmp_path / "schema.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    engine = create_engine(database_url)

    metadata.create_all(engine)

    with engine.begin() as connection:
        table_names = set(inspect(connection).get_table_names())

    assert {"users", "groups", "tasks", "subtasks", "captures", "reminders"} <= table_names
    assert "reminder_at" in tasks.c


def test_phase1_migration_creates_captures_before_tasks(monkeypatch: pytest.MonkeyPatch) -> None:
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0002_phase1_core_backend.py"
    )
    spec = importlib.util.spec_from_file_location("phase1_core_backend_migration", migration_path)
    assert spec is not None
    assert spec.loader is not None

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    create_order: list[str] = []
    monkeypatch.setattr(
        module.op,
        "create_table",
        lambda name, *args, **kwargs: create_order.append(name),
    )
    monkeypatch.setattr(module.op, "create_index", lambda *args, **kwargs: None)

    module.upgrade()

    assert create_order.index("captures") < create_order.index("tasks")
