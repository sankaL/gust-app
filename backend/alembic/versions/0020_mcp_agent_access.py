"""Add per-user MCP agent access: the users switch, access tokens and the audit log.

Revision ID: 0020_mcp_agent_access
Revises: 0019_pushover_reminders
Create Date: 2026-11-07 09:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision: str = "0020_mcp_agent_access"
down_revision: str | None = "0019_pushover_reminders"
branch_labels: tuple[str, ...] | None = None
depends_on: tuple[str, ...] | None = None

ACTOR_ID = "NULLIF(current_setting('app.current_user_id', true), '')::uuid"
INTERNAL_JOB = "(current_setting('app.internal_job', true) = 'true')"
TOKEN_LOOKUP = "(current_setting('app.mcp_token_lookup', true) = 'true')"


def upgrade() -> None:
    bind = op.get_bind()
    schema = "public" if bind.dialect.name == "postgresql" else None

    with op.batch_alter_table("users", schema=schema) as batch:
        batch.add_column(
            sa.Column("mcp_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false"))
        )
        batch.add_column(sa.Column("mcp_enabled_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "mcp_access_tokens",
        sa.Column("id", sa.Uuid(as_uuid=False), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(as_uuid=False),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("token_prefix", sa.String(length=16), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("access_level", sa.String(length=16), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("token_hash", name="uq_mcp_access_tokens_token_hash"),
        sa.CheckConstraint(
            "access_level IN ('read', 'read_write')",
            name="ck_mcp_access_tokens_access_level",
        ),
        sa.CheckConstraint(
            "length(trim(name)) > 0",
            name="ck_mcp_access_tokens_name_not_blank",
        ),
        sa.CheckConstraint(
            "length(token_hash) = 64",
            name="ck_mcp_access_tokens_hash_length",
        ),
        schema=schema,
    )
    op.create_index(
        "ix_mcp_access_tokens_user_created_at",
        "mcp_access_tokens",
        ["user_id", sa.text("created_at DESC")],
        schema=schema,
    )

    op.create_table(
        "mcp_audit_events",
        sa.Column("id", sa.Uuid(as_uuid=False), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(as_uuid=False),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "token_id",
            sa.Uuid(as_uuid=False),
            sa.ForeignKey("mcp_access_tokens.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("tool_name", sa.String(length=64), nullable=False),
        sa.Column("target_type", sa.String(length=16), nullable=True),
        sa.Column("target_id", sa.Uuid(as_uuid=False), nullable=True),
        sa.Column("target_ids", sa.JSON(), nullable=True),
        sa.Column("outcome", sa.String(length=16), nullable=False),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("idempotency_key", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.CheckConstraint(
            "outcome IN ('ok', 'error', 'denied')",
            name="ck_mcp_audit_events_outcome",
        ),
        sa.CheckConstraint(
            "target_type IS NULL OR target_type IN ('task', 'subtask', 'group')",
            name="ck_mcp_audit_events_target_type",
        ),
        schema=schema,
    )
    op.create_index(
        "ix_mcp_audit_events_user_created_at",
        "mcp_audit_events",
        ["user_id", sa.text("created_at DESC")],
        schema=schema,
    )
    op.create_index(
        "ix_mcp_audit_events_created_at",
        "mcp_audit_events",
        ["created_at"],
        schema=schema,
    )
    op.create_index(
        "ix_mcp_audit_events_token_id",
        "mcp_audit_events",
        ["token_id"],
        schema=schema,
    )
    op.create_index(
        "uq_mcp_audit_events_token_idempotency_key",
        "mcp_audit_events",
        ["token_id", "idempotency_key"],
        unique=True,
        schema=schema,
        postgresql_where=sa.text("idempotency_key IS NOT NULL"),
        sqlite_where=sa.text("idempotency_key IS NOT NULL"),
    )

    if bind.dialect.name != "postgresql":
        return

    owner_check = f"({INTERNAL_JOB} OR (user_id = {ACTOR_ID}))"
    op.execute("ALTER TABLE public.mcp_access_tokens ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.mcp_access_tokens FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY mcp_access_tokens_actor_rls ON public.mcp_access_tokens "
        f"AS PERMISSIVE FOR ALL TO PUBLIC USING {owner_check} WITH CHECK {owner_check}"
    )
    # A bearer token is resolved before its owner is known, so the lookup runs under a
    # dedicated actor that may only read token rows. It can never write them.
    op.execute(
        "CREATE POLICY mcp_access_tokens_token_lookup ON public.mcp_access_tokens "
        f"AS PERMISSIVE FOR SELECT TO PUBLIC USING {TOKEN_LOOKUP}"
    )

    audit_check = (
        f"({INTERNAL_JOB} OR ((user_id = {ACTOR_ID}) AND EXISTS ("
        "SELECT 1 FROM public.mcp_access_tokens owner_token "
        "WHERE owner_token.id = mcp_audit_events.token_id "
        "AND owner_token.user_id = mcp_audit_events.user_id)))"
    )
    op.execute("ALTER TABLE public.mcp_audit_events ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.mcp_audit_events FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY mcp_audit_events_actor_rls ON public.mcp_audit_events "
        f"AS PERMISSIVE FOR ALL TO PUBLIC USING {audit_check} WITH CHECK {audit_check}"
    )

    for table_name in ("mcp_access_tokens", "mcp_audit_events"):
        op.execute(f"REVOKE ALL PRIVILEGES ON TABLE public.{table_name} FROM PUBLIC")
    op.execute(
        "DO $$ BEGIN "
        "IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN "
        "REVOKE ALL PRIVILEGES ON TABLE public.mcp_access_tokens FROM anon; "
        "REVOKE ALL PRIVILEGES ON TABLE public.mcp_audit_events FROM anon; END IF; "
        "IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN "
        "REVOKE ALL PRIVILEGES ON TABLE public.mcp_access_tokens FROM authenticated; "
        "REVOKE ALL PRIVILEGES ON TABLE public.mcp_audit_events FROM authenticated; END IF; "
        "IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gust_app_runtime') THEN "
        "GRANT SELECT, INSERT, UPDATE ON TABLE public.mcp_access_tokens TO gust_app_runtime; "
        "GRANT SELECT, INSERT, DELETE ON TABLE public.mcp_audit_events TO gust_app_runtime; "
        "END IF; "
        "END $$;"
    )


def downgrade() -> None:
    # Token rows are the only record of what an agent was allowed to do. Retain them, and the
    # additive users columns, rather than deleting them during an application rollback.
    return
