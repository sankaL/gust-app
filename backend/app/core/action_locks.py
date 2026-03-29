from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import sqlalchemy as sa

from app.db.engine import connection_scope
from app.db.schema import rate_limit_counters


class ActionLockBusyError(Exception):
    pass


_ACTION_LOCK_WINDOW_START = datetime(1970, 1, 1, tzinfo=timezone.utc)
_ACTION_LOCK_WINDOW_SECONDS = 0
_ACTION_LOCK_LEASE_SECONDS = 15 * 60


@contextmanager
def user_action_lock(*, database_url: str, user_id: str, action: str) -> Iterator[None]:
    lock_scope = f"action_lock:{action}"
    subject_key = f"user:{user_id}"
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(seconds=_ACTION_LOCK_LEASE_SECONDS)

    if not _acquire_action_lock(
        database_url=database_url,
        scope=lock_scope,
        subject_key=subject_key,
        now=now,
        expires_at=expires_at,
    ):
        raise ActionLockBusyError()
    try:
        yield
    finally:
        _release_action_lock(
            database_url=database_url,
            scope=lock_scope,
            subject_key=subject_key,
        )


def _acquire_action_lock(
    *,
    database_url: str,
    scope: str,
    subject_key: str,
    now: datetime,
    expires_at: datetime,
) -> bool:
    with connection_scope(database_url) as connection:
        connection.execute(
            rate_limit_counters.delete().where(
                rate_limit_counters.c.scope == scope,
                rate_limit_counters.c.subject_key == subject_key,
                rate_limit_counters.c.window_start == _ACTION_LOCK_WINDOW_START,
                rate_limit_counters.c.window_seconds == _ACTION_LOCK_WINDOW_SECONDS,
                rate_limit_counters.c.expires_at <= now,
            )
        )
        result = connection.execute(
            _lock_insert_statement(
                connection=connection,
                scope=scope,
                subject_key=subject_key,
                expires_at=expires_at,
            )
        )
    return bool(result.rowcount)


def _release_action_lock(
    *,
    database_url: str,
    scope: str,
    subject_key: str,
) -> None:
    with connection_scope(database_url) as connection:
        connection.execute(
            rate_limit_counters.delete().where(
                rate_limit_counters.c.scope == scope,
                rate_limit_counters.c.subject_key == subject_key,
                rate_limit_counters.c.window_start == _ACTION_LOCK_WINDOW_START,
                rate_limit_counters.c.window_seconds == _ACTION_LOCK_WINDOW_SECONDS,
            )
        )


def _lock_insert_statement(
    *,
    connection,
    scope: str,
    subject_key: str,
    expires_at: datetime,
):
    values = {
        "scope": scope,
        "subject_key": subject_key,
        "window_start": _ACTION_LOCK_WINDOW_START,
        "window_seconds": _ACTION_LOCK_WINDOW_SECONDS,
        "request_count": 1,
        "expires_at": expires_at,
    }
    index_elements = [
        rate_limit_counters.c.scope,
        rate_limit_counters.c.subject_key,
        rate_limit_counters.c.window_start,
        rate_limit_counters.c.window_seconds,
    ]
    if connection.dialect.name == "sqlite":
        return (
            sa.dialects.sqlite.insert(rate_limit_counters)
            .values(**values)
            .on_conflict_do_nothing(
                index_elements=index_elements,
            )
        )
    return sa.dialects.postgresql.insert(
        rate_limit_counters,
    ).values(**values).on_conflict_do_nothing(
        index_elements=index_elements,
    )
