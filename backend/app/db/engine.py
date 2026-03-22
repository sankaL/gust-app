from collections.abc import Iterator
from contextlib import contextmanager
from typing import Optional

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Connection, Engine

from app.core.settings import get_settings


def build_engine(database_url: Optional[str] = None) -> Engine:
    url = database_url or get_settings().database_url
    engine = create_engine(url, pool_pre_ping=True)
    if engine.dialect.name == "sqlite":
        event.listen(engine, "connect", _enable_sqlite_foreign_keys)
    return engine


@contextmanager
def connection_scope(database_url: Optional[str] = None) -> Iterator[Connection]:
    engine = build_engine(database_url)
    try:
        with engine.begin() as connection:
            yield connection
    finally:
        engine.dispose()


def _enable_sqlite_foreign_keys(dbapi_connection, connection_record) -> None:  # type: ignore[no-untyped-def]
    del connection_record
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()
