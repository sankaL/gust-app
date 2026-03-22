from collections.abc import Iterator
from contextlib import contextmanager
from typing import Optional

from sqlalchemy import create_engine
from sqlalchemy.engine import Connection, Engine

from app.core.settings import get_settings


def build_engine(database_url: Optional[str] = None) -> Engine:
    url = database_url or get_settings().database_url
    return create_engine(url, pool_pre_ping=True)


@contextmanager
def connection_scope(database_url: Optional[str] = None) -> Iterator[Connection]:
    engine = build_engine(database_url)
    try:
        with engine.begin() as connection:
            yield connection
    finally:
        engine.dispose()
