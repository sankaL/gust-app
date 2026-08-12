"""Ensure the application auth allowlist exists outside hosted Supabase.

Revision ID: 0018_ensure_allowed_users
Revises: 0017_harden_alembic_metadata
Create Date: 2026-08-12 12:18:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0018_ensure_allowed_users"
down_revision: str | None = "0017_harden_alembic_metadata"
branch_labels: tuple[str, ...] | None = None
depends_on: tuple[str, ...] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    schema = "public" if bind.dialect.name == "postgresql" else None
    if not sa.inspect(bind).has_table("allowed_users", schema=schema):
        op.create_table(
            "allowed_users",
            sa.Column("email", sa.Text(), primary_key=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("CURRENT_TIMESTAMP"),
            ),
            schema=schema,
        )

    if bind.dialect.name != "postgresql":
        return

    op.execute("REVOKE ALL PRIVILEGES ON TABLE public.allowed_users FROM PUBLIC")
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
            REVOKE ALL PRIVILEGES ON TABLE public.allowed_users FROM anon;
          END IF;
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
            REVOKE ALL PRIVILEGES ON TABLE public.allowed_users FROM authenticated;
          END IF;
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gust_app_runtime') THEN
            REVOKE ALL PRIVILEGES ON TABLE public.allowed_users FROM gust_app_runtime;
            GRANT SELECT ON TABLE public.allowed_users TO gust_app_runtime;
          END IF;
        END;
        $$;
        """
    )


def downgrade() -> None:
    # The table may predate this revision in hosted Supabase projects. Never drop an
    # authentication allowlist whose ownership cannot be established safely.
    return
