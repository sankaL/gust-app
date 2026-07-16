"""Harden Alembic revision metadata access.

Revision ID: 0017_harden_alembic_metadata
Revises: 0016_harden_rls_relationships
Create Date: 2026-07-15 23:35:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0017_harden_alembic_metadata"
down_revision: str | None = "0016_harden_rls_relationships"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute("ALTER TABLE public.alembic_version ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE public.alembic_version NO FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        DO $$
        DECLARE
          policy_record record;
        BEGIN
          FOR policy_record IN
            SELECT policyname
              FROM pg_policies
             WHERE schemaname = 'public'
               AND tablename = 'alembic_version'
          LOOP
            EXECUTE format(
              'DROP POLICY %I ON public.alembic_version',
              policy_record.policyname
            );
          END LOOP;
        END;
        $$;
        """
    )
    op.execute("REVOKE ALL PRIVILEGES ON TABLE public.alembic_version FROM PUBLIC")
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
            REVOKE ALL PRIVILEGES ON TABLE public.alembic_version FROM anon;
          END IF;
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
            REVOKE ALL PRIVILEGES ON TABLE public.alembic_version FROM authenticated;
          END IF;
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
            REVOKE ALL PRIVILEGES ON TABLE public.alembic_version FROM service_role;
          END IF;
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gust_app_runtime') THEN
            REVOKE ALL PRIVILEGES ON TABLE public.alembic_version FROM gust_app_runtime;
            GRANT SELECT ON TABLE public.alembic_version TO gust_app_runtime;
            EXECUTE 'CREATE POLICY alembic_version_runtime_read '
                    'ON public.alembic_version AS PERMISSIVE FOR SELECT '
                    'TO gust_app_runtime USING (true)';
          END IF;
        END;
        $$;
        """
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute(
        "DROP POLICY IF EXISTS alembic_version_runtime_read "
        "ON public.alembic_version"
    )
    op.execute("ALTER TABLE public.alembic_version DISABLE ROW LEVEL SECURITY")
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gust_app_runtime') THEN
            GRANT SELECT ON TABLE public.alembic_version TO gust_app_runtime;
          END IF;
        END;
        $$;
        """
    )
