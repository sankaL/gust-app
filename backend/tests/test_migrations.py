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
            text("INSERT INTO alembic_version (version_num) VALUES ('0010_enable_postgres_rls')")
        )

    check_required_revision(database_url, "0010_enable_postgres_rls")


def test_check_required_revision_accepts_newer_revision_than_required(tmp_path: Path) -> None:
    database_path = tmp_path / "gust-newer.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    engine = create_engine(database_url)

    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)"))
        connection.execute(
            text("INSERT INTO alembic_version (version_num) VALUES ('0010_enable_postgres_rls')")
        )

    check_required_revision(database_url, "0007_add_tasks_pagination_index")


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

    assert {
        "allowed_users",
        "users",
        "groups",
        "tasks",
        "subtasks",
        "captures",
        "reminders",
        "digest_dispatches",
    } <= table_names
    assert "reminder_at" in tasks.c
    assert "description" in tasks.c
    assert "description" in metadata.tables["extracted_tasks"].c
    capture_fk = next(
        foreign_key
        for foreign_key in foreign_keys
        if foreign_key["constrained_columns"] == ["capture_id"]
    )
    assert capture_fk["options"].get("ondelete") == "SET NULL"


def test_phase1_migration_creates_captures_before_tasks(monkeypatch: pytest.MonkeyPatch) -> None:
    migration_path = (
        Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0002_phase1_core_backend.py"
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
    spec = importlib.util.spec_from_file_location(
        "phase4_reminders_retention_migration", migration_path
    )
    assert spec is not None
    assert spec.loader is not None

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    assert module.revision == "0004_phase4_reminders_retention"
    assert module.down_revision == "0003_phase2_capture_extraction"


def test_phase8_migration_adds_digest_dispatch_table_and_cancels_legacy_reminders() -> None:
    migration_path = (
        Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0008_digest_dispatches.py"
    )
    spec = importlib.util.spec_from_file_location("digest_dispatches_migration", migration_path)
    assert spec is not None
    assert spec.loader is not None

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    created_tables: list[str] = []
    created_indexes: list[str] = []
    executed_sql: list[str] = []

    module.op.create_table = lambda name, *args, **kwargs: created_tables.append(name)
    module.op.create_index = lambda name, *args, **kwargs: created_indexes.append(name)
    module.op.execute = lambda statement: executed_sql.append(statement)

    module.upgrade()

    assert module.revision == "0008_digest_dispatches"
    assert module.down_revision == "0007_add_tasks_pagination_index"
    assert "digest_dispatches" in created_tables
    assert "uq_digest_dispatches_user_period" in created_indexes
    assert "ix_digest_dispatches_type_period" in created_indexes
    assert "ix_digest_dispatches_idempotency_key" in created_indexes
    assert any(
        "UPDATE reminders" in statement and "status IN ('pending', 'claimed')" in statement
        for statement in executed_sql
    )


def test_phase9_migration_adds_task_description_columns() -> None:
    migration_path = (
        Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0009_task_descriptions.py"
    )
    spec = importlib.util.spec_from_file_location("task_descriptions_migration", migration_path)
    assert spec is not None
    assert spec.loader is not None

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    added_columns: list[tuple[str, str]] = []
    dropped_columns: list[tuple[str, str]] = []

    module.op.add_column = lambda table_name, column: added_columns.append(
        (table_name, column.name)
    )
    module.op.drop_column = lambda table_name, column_name: dropped_columns.append(
        (table_name, column_name)
    )

    module.upgrade()
    module.downgrade()

    assert module.revision == "0009_task_descriptions"
    assert module.down_revision == "0008_digest_dispatches"
    assert ("tasks", "description") in added_columns
    assert ("extracted_tasks", "description") in added_columns
    assert ("tasks", "description") in dropped_columns
    assert ("extracted_tasks", "description") in dropped_columns


def test_phase10_migration_enables_postgres_rls_policies() -> None:
    migration_path = (
        Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0010_enable_postgres_rls.py"
    )
    spec = importlib.util.spec_from_file_location("enable_postgres_rls_migration", migration_path)
    assert spec is not None
    assert spec.loader is not None

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    class _Dialect:
        name = "postgresql"

    class _Bind:
        dialect = _Dialect()

    executed_sql: list[str] = []
    module.op.get_bind = lambda: _Bind()
    module.op.execute = lambda statement: executed_sql.append(statement)

    module.upgrade()

    assert module.revision == "0010_enable_postgres_rls"
    assert module.down_revision == "0009_task_descriptions"
    assert "ALTER TABLE public.users ENABLE ROW LEVEL SECURITY" in executed_sql
    assert "ALTER TABLE public.users FORCE ROW LEVEL SECURITY" in executed_sql
    assert any(
        "CREATE POLICY users_actor_rls ON public.users" in statement
        and "current_setting('app.current_user_id', true)::uuid = id" in statement
        for statement in executed_sql
    )
    assert any(
        "CREATE POLICY digest_dispatches_actor_rls ON public.digest_dispatches" in statement
        and "current_setting('app.internal_job', true) = 'true'" in statement
        for statement in executed_sql
    )


def test_phase12_migration_revokes_public_access_to_rate_limit_counters() -> None:
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0012_harden_backend_table_grants.py"
    )
    spec = importlib.util.spec_from_file_location(
        "harden_backend_table_grants_migration",
        migration_path,
    )
    assert spec is not None
    assert spec.loader is not None

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    class _Dialect:
        name = "postgresql"

    class _Bind:
        dialect = _Dialect()

    executed_sql: list[str] = []
    module.op.get_bind = lambda: _Bind()
    module.op.execute = lambda statement: executed_sql.append(statement)

    module.upgrade()

    assert module.revision == "0012_harden_backend_table_grants"
    assert module.down_revision == "0011_rate_limit_counters"
    assert any(
        "REVOKE ALL PRIVILEGES ON TABLE public.rate_limit_counters" in statement
        and "anon" in statement
        and "authenticated" in statement
        for statement in executed_sql
    )
    assert any(
        "GRANT SELECT, INSERT, UPDATE, DELETE" in statement
        and "public.rate_limit_counters" in statement
        and "gust_app_runtime" in statement
        for statement in executed_sql
    )


def test_supabase_allowlist_hardening_migration_revokes_public_roles() -> None:
    migration_path = (
        Path(__file__).resolve().parents[2]
        / "supabase"
        / "migrations"
        / "20260328214500_harden_allowed_users_grants.sql"
    )

    sql = migration_path.read_text(encoding="utf-8")

    assert "revoke all privileges on table public.allowed_users from public, anon, authenticated;" in sql
    assert "revoke all privileges on table public.allowed_users from gust_app_runtime;" in sql
    assert "grant select on table public.allowed_users to supabase_auth_admin;" in sql
    assert "grant select on table public.allowed_users to gust_app_runtime;" in sql


def test_phase10_migration_noops_for_sqlite() -> None:
    migration_path = (
        Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0010_enable_postgres_rls.py"
    )
    spec = importlib.util.spec_from_file_location("enable_postgres_rls_migration", migration_path)
    assert spec is not None
    assert spec.loader is not None

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    class _Dialect:
        name = "sqlite"

    class _Bind:
        dialect = _Dialect()

    executed_sql: list[str] = []
    module.op.get_bind = lambda: _Bind()
    module.op.execute = lambda statement: executed_sql.append(statement)

    module.upgrade()

    assert executed_sql == []
