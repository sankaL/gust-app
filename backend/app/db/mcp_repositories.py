"""Queries for MCP agent access: the per-user switch, access tokens and the audit log.

Every function except `find_mcp_access_token_by_hash` filters by `user_id` explicitly. RLS is
defense in depth on top of that, never the only guard.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from app.db.schema import groups, mcp_access_tokens, mcp_audit_events, tasks, users


@dataclass(frozen=True)
class UserMcpState:
    enabled: bool
    enabled_at: datetime | None


@dataclass(frozen=True)
class McpAccessTokenRecord:
    id: str
    user_id: str
    name: str
    token_prefix: str
    access_level: str
    created_at: datetime
    expires_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None


@dataclass(frozen=True)
class McpTokenLookupRecord:
    id: str
    user_id: str
    access_level: str
    expires_at: datetime
    revoked_at: datetime | None
    last_used_at: datetime | None


@dataclass(frozen=True)
class McpAuditEventRecord:
    id: str
    token_id: str
    token_name: str | None
    tool_name: str
    target_type: str | None
    target_id: str | None
    target_ids: list[str] | None
    outcome: str
    error_code: str | None
    created_at: datetime


@dataclass(frozen=True)
class OpenTaskBucketCounts:
    overdue: int
    due_today: int
    needs_review: int


def _row_to_token(row: sa.Row) -> McpAccessTokenRecord:
    return McpAccessTokenRecord(
        id=str(row.id),
        user_id=str(row.user_id),
        name=row.name,
        token_prefix=row.token_prefix,
        access_level=row.access_level,
        created_at=row.created_at,
        expires_at=row.expires_at,
        last_used_at=row.last_used_at,
        revoked_at=row.revoked_at,
    )


def _active_token_conditions(*, user_id: str, now: datetime) -> list[object]:
    return [
        mcp_access_tokens.c.user_id == user_id,
        mcp_access_tokens.c.revoked_at.is_(None),
        mcp_access_tokens.c.expires_at > now,
    ]


def get_user_mcp_state(connection: Connection, *, user_id: str) -> UserMcpState | None:
    row = connection.execute(
        sa.select(users.c.mcp_enabled, users.c.mcp_enabled_at).where(users.c.id == user_id)
    ).first()
    if row is None:
        return None
    return UserMcpState(enabled=bool(row.mcp_enabled), enabled_at=row.mcp_enabled_at)


def set_user_mcp_enabled(
    connection: Connection,
    *,
    user_id: str,
    enabled: bool,
    now: datetime,
) -> None:
    values: dict[str, object] = {"mcp_enabled": enabled, "updated_at": now}
    if enabled:
        values["mcp_enabled_at"] = now
    connection.execute(users.update().where(users.c.id == user_id).values(**values))


def create_mcp_access_token(
    connection: Connection,
    *,
    user_id: str,
    name: str,
    token_prefix: str,
    token_hash: str,
    access_level: str,
    created_at: datetime,
    expires_at: datetime,
) -> McpAccessTokenRecord:
    token_id = str(uuid.uuid4())
    connection.execute(
        mcp_access_tokens.insert().values(
            id=token_id,
            user_id=user_id,
            name=name,
            token_prefix=token_prefix,
            token_hash=token_hash,
            access_level=access_level,
            created_at=created_at,
            expires_at=expires_at,
        )
    )
    row = connection.execute(
        sa.select(mcp_access_tokens).where(
            mcp_access_tokens.c.id == token_id,
            mcp_access_tokens.c.user_id == user_id,
        )
    ).one()
    return _row_to_token(row)


def list_active_mcp_access_tokens(
    connection: Connection,
    *,
    user_id: str,
    now: datetime,
) -> list[McpAccessTokenRecord]:
    rows = connection.execute(
        sa.select(mcp_access_tokens)
        .where(*_active_token_conditions(user_id=user_id, now=now))
        .order_by(mcp_access_tokens.c.created_at.desc(), mcp_access_tokens.c.id.desc())
    ).fetchall()
    return [_row_to_token(row) for row in rows]


def count_active_mcp_access_tokens(connection: Connection, *, user_id: str, now: datetime) -> int:
    return int(
        connection.execute(
            sa.select(sa.func.count(mcp_access_tokens.c.id)).where(
                *_active_token_conditions(user_id=user_id, now=now)
            )
        ).scalar_one()
    )


def get_mcp_access_token(
    connection: Connection,
    *,
    user_id: str,
    token_id: str,
) -> McpAccessTokenRecord | None:
    row = connection.execute(
        sa.select(mcp_access_tokens).where(
            mcp_access_tokens.c.id == token_id,
            mcp_access_tokens.c.user_id == user_id,
        )
    ).first()
    return _row_to_token(row) if row is not None else None


def revoke_mcp_access_token(
    connection: Connection,
    *,
    user_id: str,
    token_id: str,
    now: datetime,
) -> None:
    connection.execute(
        mcp_access_tokens.update()
        .where(
            mcp_access_tokens.c.id == token_id,
            mcp_access_tokens.c.user_id == user_id,
            mcp_access_tokens.c.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )


def revoke_all_mcp_access_tokens(connection: Connection, *, user_id: str, now: datetime) -> int:
    result = connection.execute(
        mcp_access_tokens.update()
        .where(
            mcp_access_tokens.c.user_id == user_id,
            mcp_access_tokens.c.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )
    return int(result.rowcount or 0)


def find_mcp_access_token_by_hash(
    connection: Connection,
    *,
    token_hash: str,
) -> McpTokenLookupRecord | None:
    """Resolve a bearer token by its hash. Runs under the token-lookup actor, before the owner
    is known, so it reads only the columns needed to authorize the request."""
    row = connection.execute(
        sa.select(
            mcp_access_tokens.c.id,
            mcp_access_tokens.c.user_id,
            mcp_access_tokens.c.access_level,
            mcp_access_tokens.c.expires_at,
            mcp_access_tokens.c.revoked_at,
            mcp_access_tokens.c.last_used_at,
        ).where(mcp_access_tokens.c.token_hash == token_hash)
    ).first()
    if row is None:
        return None
    return McpTokenLookupRecord(
        id=str(row.id),
        user_id=str(row.user_id),
        access_level=row.access_level,
        expires_at=row.expires_at,
        revoked_at=row.revoked_at,
        last_used_at=row.last_used_at,
    )


def touch_mcp_access_token(
    connection: Connection,
    *,
    user_id: str,
    token_id: str,
    now: datetime,
) -> None:
    connection.execute(
        mcp_access_tokens.update()
        .where(
            mcp_access_tokens.c.id == token_id,
            mcp_access_tokens.c.user_id == user_id,
        )
        .values(last_used_at=now)
    )


def insert_mcp_audit_event(
    connection: Connection,
    *,
    user_id: str,
    token_id: str,
    tool_name: str,
    outcome: str,
    created_at: datetime,
    target_type: str | None = None,
    target_id: str | None = None,
    target_ids: list[str] | None = None,
    error_code: str | None = None,
    idempotency_key: str | None = None,
) -> None:
    connection.execute(
        mcp_audit_events.insert().values(
            id=str(uuid.uuid4()),
            user_id=user_id,
            token_id=token_id,
            tool_name=tool_name,
            target_type=target_type,
            target_id=target_id,
            target_ids=target_ids,
            outcome=outcome,
            error_code=error_code,
            idempotency_key=idempotency_key,
            created_at=created_at,
        )
    )


def find_mcp_audit_event_by_idempotency_key(
    connection: Connection,
    *,
    user_id: str,
    token_id: str,
    idempotency_key: str,
) -> McpAuditEventRecord | None:
    row = connection.execute(
        sa.select(mcp_audit_events).where(
            mcp_audit_events.c.user_id == user_id,
            mcp_audit_events.c.token_id == token_id,
            mcp_audit_events.c.idempotency_key == idempotency_key,
        )
    ).first()
    if row is None:
        return None
    return _row_to_audit_event(row, token_name=None)


def list_recent_mcp_audit_events(
    connection: Connection,
    *,
    user_id: str,
    limit: int,
) -> list[McpAuditEventRecord]:
    rows = connection.execute(
        sa.select(mcp_audit_events, mcp_access_tokens.c.name.label("token_name"))
        .join(
            mcp_access_tokens,
            sa.and_(
                mcp_access_tokens.c.id == mcp_audit_events.c.token_id,
                mcp_access_tokens.c.user_id == mcp_audit_events.c.user_id,
            ),
        )
        .where(mcp_audit_events.c.user_id == user_id)
        .order_by(mcp_audit_events.c.created_at.desc(), mcp_audit_events.c.id.desc())
        .limit(limit)
    ).fetchall()
    return [_row_to_audit_event(row, token_name=row.token_name) for row in rows]


def delete_expired_mcp_audit_events(
    connection: Connection,
    *,
    created_before: datetime,
    limit: int,
) -> int:
    """Retention cleanup. Runs under the internal-job actor."""
    expired_ids = (
        sa.select(mcp_audit_events.c.id)
        .where(mcp_audit_events.c.created_at < created_before)
        .order_by(mcp_audit_events.c.created_at)
        .limit(limit)
        .scalar_subquery()
    )
    result = connection.execute(
        mcp_audit_events.delete().where(mcp_audit_events.c.id.in_(expired_ids))
    )
    return int(result.rowcount or 0)


def task_titles_by_id(connection: Connection, *, user_id: str, task_ids: list[str]) -> dict:
    if not task_ids:
        return {}
    rows = connection.execute(
        sa.select(tasks.c.id, tasks.c.title).where(
            tasks.c.user_id == user_id,
            tasks.c.id.in_(task_ids),
        )
    ).fetchall()
    return {str(row.id): row.title for row in rows}


def group_names_by_id(connection: Connection, *, user_id: str, group_ids: list[str]) -> dict:
    if not group_ids:
        return {}
    rows = connection.execute(
        sa.select(groups.c.id, groups.c.name).where(
            groups.c.user_id == user_id,
            groups.c.id.in_(group_ids),
        )
    ).fetchall()
    return {str(row.id): row.name for row in rows}


def count_open_task_buckets(
    connection: Connection,
    *,
    user_id: str,
    today: date,
) -> OpenTaskBucketCounts:
    row = connection.execute(
        sa.select(
            sa.func.coalesce(sa.func.sum(sa.case((tasks.c.due_date < today, 1), else_=0)), 0).label(
                "overdue"
            ),
            sa.func.coalesce(
                sa.func.sum(sa.case((tasks.c.due_date == today, 1), else_=0)), 0
            ).label("due_today"),
            sa.func.coalesce(
                sa.func.sum(sa.case((tasks.c.needs_review.is_(True), 1), else_=0)), 0
            ).label("needs_review"),
        ).where(
            tasks.c.user_id == user_id,
            tasks.c.status == "open",
            tasks.c.deleted_at.is_(None),
        )
    ).one()
    return OpenTaskBucketCounts(
        overdue=int(row.overdue),
        due_today=int(row.due_today),
        needs_review=int(row.needs_review),
    )


def audit_retention_cutoff(now: datetime, *, retention_days: int) -> datetime:
    return now - timedelta(days=retention_days)


def _row_to_audit_event(row: sa.Row, *, token_name: str | None) -> McpAuditEventRecord:
    target_ids = row.target_ids
    return McpAuditEventRecord(
        id=str(row.id),
        token_id=str(row.token_id),
        token_name=token_name,
        tool_name=row.tool_name,
        target_type=row.target_type,
        target_id=str(row.target_id) if row.target_id is not None else None,
        target_ids=[str(item) for item in target_ids] if isinstance(target_ids, list) else None,
        outcome=row.outcome,
        error_code=row.error_code,
        created_at=row.created_at,
    )


def find_group_by_name(connection: Connection, *, user_id: str, name: str) -> str | None:
    """Return the ID of the user's group with this name, matched ignoring case."""
    row = connection.execute(
        sa.select(groups.c.id).where(
            groups.c.user_id == user_id,
            sa.func.lower(groups.c.name) == name.strip().lower(),
        )
    ).first()
    return str(row.id) if row is not None else None
