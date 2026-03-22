from __future__ import annotations

# ruff: noqa: UP045
import uuid
from dataclasses import dataclass
from typing import Optional

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from app.db.schema import groups, users


@dataclass
class UserRecord:
    id: str
    email: str
    display_name: Optional[str]
    timezone: str


@dataclass
class GroupRecord:
    id: str
    user_id: str
    name: str
    description: Optional[str]
    is_system: bool
    system_key: Optional[str]


@dataclass
class SessionContext:
    user: UserRecord
    inbox_group_id: str


def _row_to_user(row: sa.Row) -> UserRecord:
    return UserRecord(
        id=str(row.id),
        email=row.email,
        display_name=row.display_name,
        timezone=row.timezone,
    )


def upsert_user(
    connection: Connection,
    *,
    user_id: str,
    email: str,
    display_name: Optional[str],
    timezone: str,
) -> UserRecord:
    dialect_name = connection.dialect.name
    values = {
        "id": user_id,
        "email": email,
        "display_name": display_name,
        "timezone": timezone,
    }

    if dialect_name == "sqlite":
        insert_stmt = sa.dialects.sqlite.insert(users).values(**values)
        statement = insert_stmt.on_conflict_do_update(
            index_elements=[users.c.id],
            set_={
                "email": email,
                "display_name": display_name,
                "timezone": timezone,
                "updated_at": sa.text("CURRENT_TIMESTAMP"),
            },
        )
    else:
        insert_stmt = sa.dialects.postgresql.insert(users).values(**values)
        statement = insert_stmt.on_conflict_do_update(
            index_elements=[users.c.id],
            set_={
                "email": email,
                "display_name": display_name,
                "timezone": timezone,
                "updated_at": sa.text("CURRENT_TIMESTAMP"),
            },
        )

    connection.execute(statement)
    row = connection.execute(sa.select(users).where(users.c.id == user_id)).one()
    return _row_to_user(row)


def get_user(connection: Connection, user_id: str) -> Optional[UserRecord]:
    row = connection.execute(sa.select(users).where(users.c.id == user_id)).first()
    if row is None:
        return None
    return _row_to_user(row)


def update_user_timezone(
    connection: Connection,
    *,
    user_id: str,
    timezone: str,
) -> Optional[UserRecord]:
    connection.execute(
        users.update()
        .where(users.c.id == user_id)
        .values(timezone=timezone, updated_at=sa.text("CURRENT_TIMESTAMP"))
    )
    return get_user(connection, user_id)


def ensure_inbox_group(connection: Connection, *, user_id: str) -> GroupRecord:
    existing = connection.execute(
        sa.select(groups).where(
            groups.c.user_id == user_id,
            groups.c.system_key == "inbox",
        )
    ).first()
    if existing is None:
        group_id = str(uuid.uuid4())
        connection.execute(
            groups.insert().values(
                id=group_id,
                user_id=user_id,
                name="Inbox",
                description=None,
                is_system=True,
                system_key="inbox",
            )
        )
        existing = connection.execute(sa.select(groups).where(groups.c.id == group_id)).one()

    return GroupRecord(
        id=str(existing.id),
        user_id=str(existing.user_id),
        name=existing.name,
        description=existing.description,
        is_system=bool(existing.is_system),
        system_key=existing.system_key,
    )


def get_session_context(connection: Connection, user_id: str) -> Optional[SessionContext]:
    user = get_user(connection, user_id)
    if user is None:
        return None

    inbox_group = ensure_inbox_group(connection, user_id=user_id)
    return SessionContext(user=user, inbox_group_id=inbox_group.id)
