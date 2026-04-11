from __future__ import annotations

import pytest

from app.db.engine import (
    DATABASE_INTERNAL_JOB_SETTING,
    DATABASE_USER_ID_SETTING,
    INTERNAL_JOB_SENTINEL_USER_ID,
    DatabaseActor,
    _apply_database_actor,
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


def test_apply_database_actor_rejects_blank_user_id() -> None:
    connection = _ConnectionStub("postgresql")

    with pytest.raises(ValueError, match="non-empty UUID"):
        _apply_database_actor(connection, DatabaseActor(user_id="   "))


def test_apply_database_actor_rejects_invalid_user_id() -> None:
    connection = _ConnectionStub("postgresql")

    with pytest.raises(ValueError, match="valid UUID"):
        _apply_database_actor(connection, DatabaseActor(user_id="not-a-uuid"))
