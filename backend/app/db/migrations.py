from typing import Optional

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection

from app.db.engine import connection_scope


class MigrationVersionError(RuntimeError):
    """Raised when the database revision does not satisfy the application contract."""


def get_current_revision(connection: Connection) -> Optional[str]:
    inspector = inspect(connection)
    if "alembic_version" not in inspector.get_table_names():
        return None

    result = connection.execute(text("SELECT version_num FROM alembic_version LIMIT 1"))
    row = result.first()
    return None if row is None else str(row[0])


def check_required_revision(database_url: str, required_revision: str) -> None:
    with connection_scope(database_url) as connection:
        current_revision = get_current_revision(connection)

    if current_revision != required_revision:
        raise MigrationVersionError(
            "Database migration level mismatch. "
            f"Expected {required_revision}, found {current_revision or 'none'}."
        )
