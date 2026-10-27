from __future__ import annotations

import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from threading import Lock

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Connection, Engine, make_url

from app.core.settings import get_settings

DATABASE_USER_ID_SETTING = "app.current_user_id"
DATABASE_INTERNAL_JOB_SETTING = "app.internal_job"
INTERNAL_JOB_SENTINEL_USER_ID = "00000000-0000-0000-0000-000000000000"
# Opening a connection to the database pooler takes several cross-region round trips, so keep
# connections for 30 minutes rather than 5; pool_pre_ping still replaces any that died meanwhile.
POOL_RECYCLE_SECONDS = 30 * 60
# TCP keepalives stop idle pooled connections from being silently dropped by the network in
# between, and let a dead peer be noticed within about a minute and a half.
POSTGRES_KEEPALIVE_CONNECT_ARGS = {
    "keepalives": 1,
    "keepalives_idle": 60,
    "keepalives_interval": 10,
    "keepalives_count": 3,
}
_engine_registry: dict[str, Engine] = {}
_engine_registry_lock = Lock()


@dataclass(frozen=True)
class DatabaseActor:
    user_id: str | None = None
    is_internal_job: bool = False


def build_engine(database_url: str | None = None) -> Engine:
    url = database_url or get_settings().database_url
    with _engine_registry_lock:
        engine = _engine_registry.get(url)
        if engine is None:
            engine = create_engine(url, **engine_options(url))
            if engine.dialect.name == "sqlite":
                event.listen(engine, "connect", _enable_sqlite_foreign_keys)
            _engine_registry[url] = engine
        return engine


def engine_options(database_url: str) -> dict[str, object]:
    options: dict[str, object] = {"pool_pre_ping": True, "pool_recycle": POOL_RECYCLE_SECONDS}
    if make_url(database_url).get_backend_name() == "postgresql":
        options["connect_args"] = dict(POSTGRES_KEEPALIVE_CONNECT_ARGS)
    return options


def dispose_engine(database_url: str | None = None) -> None:
    url = database_url or get_settings().database_url
    with _engine_registry_lock:
        engine = _engine_registry.pop(url, None)
    if engine is None:
        return
    engine.dispose()


def dispose_all_engines() -> None:
    with _engine_registry_lock:
        engines = list(_engine_registry.values())
        _engine_registry.clear()
    for engine in engines:
        engine.dispose()


@contextmanager
def connection_scope(
    database_url: str | None = None,
    *,
    actor: DatabaseActor | None = None,
) -> Iterator[Connection]:
    engine = build_engine(database_url)
    with engine.begin() as connection:
        _apply_database_actor(connection, actor)
        yield connection


def user_connection_scope(database_url: str | None = None, *, user_id: str):
    return connection_scope(database_url, actor=DatabaseActor(user_id=user_id))


def internal_job_connection_scope(database_url: str | None = None):
    return connection_scope(database_url, actor=DatabaseActor(is_internal_job=True))


def _apply_database_actor(connection: Connection, actor: DatabaseActor | None) -> None:
    if actor is None or connection.dialect.name != "postgresql":
        return

    user_setting_value: str | None = None
    if actor.user_id is not None:
        normalized_user_id = actor.user_id.strip()
        if not normalized_user_id:
            raise ValueError("Database actor user_id must be a non-empty UUID.")
        try:
            uuid.UUID(normalized_user_id)
        except ValueError as exc:
            raise ValueError("Database actor user_id must be a valid UUID.") from exc
        user_setting_value = normalized_user_id
    elif actor.is_internal_job:
        user_setting_value = INTERNAL_JOB_SENTINEL_USER_ID

    if user_setting_value is not None:
        connection.execute(
            text("SELECT set_config(:setting_name, :setting_value, true)"),
            {
                "setting_name": DATABASE_USER_ID_SETTING,
                "setting_value": user_setting_value,
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
