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
                "VALUES ('0004_phase4_reminders_retention')"
            )
        )

    check_required_revision(database_url, "0004_phase4_reminders_retention")


def test_schema_metadata_contains_required_tables_and_phase4_capture_retention_contract(
    tmp_path: Path,
) -> None:
    database_path = tmp_path / "schema.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    engine = create_engine(database_url)

    metadata.create_all(engine)

    with engine.begin() as connection:
        inspector = inspect(connection)
        table_names = set(inspector.get_table_names())
        foreign_keys = inspector.get_foreign_keys("tasks")

    assert {"users", "groups", "tasks", "subtasks", "captures", "reminders"} <= table_names
    assert "reminder_at" in tasks.c
    capture_fk = next(
        foreign_key for foreign_key in foreign_keys if foreign_key["constrained_columns"] == ["capture_id"]
    )
    assert capture_fk["options"].get("ondelete") == "SET NULL"


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


def test_phase4_migration_targets_capture_fk_change() -> None:
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0004_phase4_reminders_retention.py"
    )
    spec = importlib.util.spec_from_file_location("phase4_reminders_retention_migration", migration_path)
    assert spec is not None
    assert spec.loader is not None

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    assert module.revision == "0004_phase4_reminders_retention"
    assert module.down_revision == "0003_phase2_capture_extraction"
