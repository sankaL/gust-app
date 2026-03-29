"""Harden grants for backend-only operational tables.

Revision ID: 0012_harden_backend_table_grants
Revises: 0011_rate_limit_counters
Create Date: 2026-03-28 21:30:00.000000
"""

from __future__ import annotations

from typing import Optional, Sequence

from alembic import op

revision: str = "0012_harden_backend_table_grants"
down_revision: Optional[str] = "0011_rate_limit_counters"
branch_labels: Optional[Sequence[str]] = None
depends_on: Optional[Sequence[str]] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute(
        "REVOKE ALL PRIVILEGES ON TABLE public.rate_limit_counters "
        "FROM PUBLIC, anon, authenticated"
    )
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gust_app_runtime') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE
            ON TABLE public.rate_limit_counters
            TO gust_app_runtime;
          END IF;
        END;
        $$;
        """
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute("GRANT ALL PRIVILEGES ON TABLE public.rate_limit_counters TO anon, authenticated")
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gust_app_runtime') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE
            ON TABLE public.rate_limit_counters
            TO gust_app_runtime;
          END IF;
        END;
        $$;
        """
    )
