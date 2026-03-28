from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Connection, Engine

from app.core.settings import get_settings

DATABASE_USER_ID_SETTING = "app.current_user_id"
DATABASE_INTERNAL_JOB_SETTING = "app.internal_job"


@dataclass(frozen=True)
class DatabaseActor:
    user_id: str | None = None
    is_internal_job: bool = False


def build_engine(database_url: str | None = None) -> Engine:
    url = database_url or get_settings().database_url
    engine = create_engine(url, pool_pre_ping=True)
    if engine.dialect.name == "sqlite":
        event.listen(engine, "connect", _enable_sqlite_foreign_keys)
    return engine


@contextmanager
def connection_scope(
    database_url: str | None = None,
    *,
    actor: DatabaseActor | None = None,
) -> Iterator[Connection]:
    engine = build_engine(database_url)
    try:
        with engine.begin() as connection:
            _apply_database_actor(connection, actor)
            yield connection
    finally:
        engine.dispose()


def user_connection_scope(database_url: str | None = None, *, user_id: str):
    return connection_scope(database_url, actor=DatabaseActor(user_id=user_id))


def internal_job_connection_scope(database_url: str | None = None):
    return connection_scope(database_url, actor=DatabaseActor(is_internal_job=True))


def _apply_database_actor(connection: Connection, actor: DatabaseActor | None) -> None:
    if actor is None or connection.dialect.name != "postgresql":
        return

    if actor.user_id is not None:
        connection.execute(
            text("SELECT set_config(:setting_name, :setting_value, true)"),
            {
                "setting_name": DATABASE_USER_ID_SETTING,
                "setting_value": actor.user_id,
            },
        )

    connection.execute(
        text("SELECT set_config(:setting_name, :setting_value, true)"),
        {
            "setting_name": DATABASE_INTERNAL_JOB_SETTING,
            "setting_value": "true" if actor.is_internal_job else "false",
        },
    )


def _enable_sqlite_foreign_keys(dbapi_connection, connection_record) -> None:  # type: ignore[no-untyped-def]
    del connection_record
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()
