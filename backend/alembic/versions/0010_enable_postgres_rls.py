"""Enable Postgres row-level security for user-owned tables.

Revision ID: 0010_enable_postgres_rls
Revises: 0009_task_descriptions
Create Date: 2026-03-28 07:30:00.000000
"""

from __future__ import annotations

from typing import Optional, Sequence

from alembic import op

revision: str = "0010_enable_postgres_rls"
down_revision: Optional[str] = "0009_task_descriptions"
branch_labels: Optional[Sequence[str]] = None
depends_on: Optional[Sequence[str]] = None

TABLE_OWNER_COLUMNS: tuple[tuple[str, str], ...] = (
    ("users", "id"),
    ("groups", "user_id"),
    ("captures", "user_id"),
    ("tasks", "user_id"),
    ("subtasks", "user_id"),
    ("reminders", "user_id"),
    ("extracted_tasks", "user_id"),
    ("digest_dispatches", "user_id"),
)


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    for table_name, owner_column in TABLE_OWNER_COLUMNS:
        policy_name = _policy_name(table_name)
        policy_expression = _policy_expression(owner_column)
        op.execute(f"ALTER TABLE public.{table_name} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE public.{table_name} FORCE ROW LEVEL SECURITY")
        op.execute(f"DROP POLICY IF EXISTS {policy_name} ON public.{table_name}")
        op.execute(
            f"CREATE POLICY {policy_name} ON public.{table_name} "
            f"FOR ALL USING ({policy_expression}) WITH CHECK ({policy_expression})"
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    for table_name, _owner_column in reversed(TABLE_OWNER_COLUMNS):
        policy_name = _policy_name(table_name)
        op.execute(f"DROP POLICY IF EXISTS {policy_name} ON public.{table_name}")
        op.execute(f"ALTER TABLE public.{table_name} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE public.{table_name} DISABLE ROW LEVEL SECURITY")


def _policy_name(table_name: str) -> str:
    return f"{table_name}_actor_rls"


def _policy_expression(owner_column: str) -> str:
    return (
        "(current_setting('app.internal_job', true) = 'true') "
        f"OR (current_setting('app.current_user_id', true)::uuid = {owner_column})"
    )
