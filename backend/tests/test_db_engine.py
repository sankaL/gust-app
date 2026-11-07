from __future__ import annotations

from pathlib import Path

import pytest
from psycopg.conninfo import make_conninfo

from app.db.engine import (
    DATABASE_INTERNAL_JOB_SETTING,
    DATABASE_MCP_TOKEN_LOOKUP_SETTING,
    DATABASE_USER_ID_SETTING,
    INTERNAL_JOB_SENTINEL_USER_ID,
    POSTGRES_KEEPALIVE_CONNECT_ARGS,
    DatabaseActor,
    _apply_database_actor,
    engine_options,
)


class _Dialect:
    def __init__(self, name: str) -> None:
        self.name = name


class _ConnectionStub:
    def __init__(self, dialect_name: str) -> None:
        self.dialect = _Dialect(dialect_name)
        self.calls: list[dict[str, str]] = []

    def execute(self, statement, params):  # type: ignore[no-untyped-def]
        del statement
        self.calls.append(params)
        return None


def test_apply_database_actor_ignores_non_postgres_connections() -> None:
    connection = _ConnectionStub("sqlite")

    _apply_database_actor(connection, DatabaseActor(user_id="11111111-1111-1111-1111-111111111111"))

    assert connection.calls == []


def test_apply_database_actor_sets_sentinel_user_for_internal_jobs() -> None:
    connection = _ConnectionStub("postgresql")

    _apply_database_actor(connection, DatabaseActor(is_internal_job=True))

    assert connection.calls == [
        {
            "setting_name": DATABASE_USER_ID_SETTING,
            "setting_value": INTERNAL_JOB_SENTINEL_USER_ID,
        },
        {
            "setting_name": DATABASE_INTERNAL_JOB_SETTING,
            "setting_value": "true",
        },
    ]


def test_apply_database_actor_sets_explicit_user_id_for_user_scoped_transactions() -> None:
    connection = _ConnectionStub("postgresql")

    _apply_database_actor(connection, DatabaseActor(user_id="11111111-1111-1111-1111-111111111111"))

    assert connection.calls == [
        {
            "setting_name": DATABASE_USER_ID_SETTING,
            "setting_value": "11111111-1111-1111-1111-111111111111",
        },
        {
            "setting_name": DATABASE_INTERNAL_JOB_SETTING,
            "setting_value": "false",
        },
    ]


def test_apply_database_actor_sets_mcp_token_lookup_without_a_user() -> None:
    connection = _ConnectionStub("postgresql")

    _apply_database_actor(connection, DatabaseActor(is_mcp_token_lookup=True))

    # The 0020 token-lookup policy must read the same setting name; no user ID is set.
    migration = Path(__file__).resolve().parents[1] / "alembic/versions/0020_mcp_agent_access.py"
    assert f"current_setting('{DATABASE_MCP_TOKEN_LOOKUP_SETTING}', true)" in migration.read_text()
    assert connection.calls == [
        {
            "setting_name": DATABASE_INTERNAL_JOB_SETTING,
            "setting_value": "false",
        },
        {
            "setting_name": DATABASE_MCP_TOKEN_LOOKUP_SETTING,
            "setting_value": "true",
        },
    ]


def test_apply_database_actor_leaves_mcp_token_lookup_unset_for_users() -> None:
    connection = _ConnectionStub("postgresql")

    _apply_database_actor(connection, DatabaseActor(user_id="11111111-1111-1111-1111-111111111111"))

    assert all(
        call["setting_name"] != DATABASE_MCP_TOKEN_LOOKUP_SETTING for call in connection.calls
    )


@pytest.mark.parametrize(
    "extra",
    [
        {"user_id": "11111111-1111-1111-1111-111111111111"},
        {"is_internal_job": True},
    ],
)
def test_mcp_token_lookup_actor_cannot_also_be_a_user_or_job(extra: dict[str, object]) -> None:
    with pytest.raises(ValueError, match="token-lookup actor"):
        DatabaseActor(is_mcp_token_lookup=True, **extra)  # type: ignore[arg-type]


def test_apply_database_actor_rejects_blank_user_id() -> None:
    connection = _ConnectionStub("postgresql")

    with pytest.raises(ValueError, match="non-empty UUID"):
        _apply_database_actor(connection, DatabaseActor(user_id="   "))


def test_apply_database_actor_rejects_invalid_user_id() -> None:
    connection = _ConnectionStub("postgresql")

    with pytest.raises(ValueError, match="valid UUID"):
        _apply_database_actor(connection, DatabaseActor(user_id="not-a-uuid"))


def test_postgres_engines_keep_pooled_connections_warm() -> None:
    options = engine_options("postgresql+psycopg://gust:secret@db.example.test:5432/postgres")

    assert options["pool_pre_ping"] is True
    assert options["pool_recycle"] == 30 * 60
    assert options["connect_args"] == POSTGRES_KEEPALIVE_CONNECT_ARGS
    assert options["hide_parameters"] is True


def test_postgres_keepalive_settings_are_valid_libpq_parameters() -> None:
    conninfo = make_conninfo("host=db.example.test", **POSTGRES_KEEPALIVE_CONNECT_ARGS)

    assert "keepalives_idle=60" in conninfo


def test_sqlite_engines_do_not_receive_postgres_keepalives() -> None:
    options = engine_options("sqlite+pysqlite:///:memory:")

    assert "connect_args" not in options
    assert options["pool_recycle"] == 30 * 60
