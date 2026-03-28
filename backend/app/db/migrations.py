from __future__ import annotations

from collections import deque
from pathlib import Path

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection

from alembic.config import Config
from alembic.script import ScriptDirectory
from app.db.engine import connection_scope


class MigrationVersionError(RuntimeError):
    """Raised when the database revision does not satisfy the application contract."""


def get_current_revision(connection: Connection) -> str | None:
    inspector = inspect(connection)
    if "alembic_version" not in inspector.get_table_names():
        return None

    result = connection.execute(text("SELECT version_num FROM alembic_version LIMIT 1"))
    row = result.first()
    return None if row is None else str(row[0])


def _load_script_directory() -> ScriptDirectory:
    backend_root = Path(__file__).resolve().parents[2]
    config = Config(str(backend_root / "alembic.ini"))
    config.set_main_option("script_location", str(backend_root / "alembic"))
    return ScriptDirectory.from_config(config)


def _is_revision_at_least(current_revision: str, required_revision: str) -> bool:
    if current_revision == required_revision:
        return True

    script = _load_script_directory()
    visited: set[str] = set()
    queue: deque[str] = deque([current_revision])

    while queue:
        revision_id = queue.popleft()
        if revision_id in visited:
            continue
        visited.add(revision_id)

        revision = script.get_revision(revision_id)
        if revision is None:
            continue

        down_revisions = revision.down_revision
        if down_revisions is None:
            continue

        if isinstance(down_revisions, tuple):
            parents = [str(parent) for parent in down_revisions if parent is not None]
        else:
            parents = [str(down_revisions)]

        if required_revision in parents:
            return True

        queue.extend(parent for parent in parents if parent not in visited)

    return False


def check_required_revision(database_url: str, required_revision: str) -> None:
    with connection_scope(database_url) as connection:
        current_revision = get_current_revision(connection)

    if current_revision is None or not _is_revision_at_least(current_revision, required_revision):
        raise MigrationVersionError(
            "Database migration level mismatch. "
            f"Expected at least {required_revision}, found {current_revision or 'none'}."
        )
