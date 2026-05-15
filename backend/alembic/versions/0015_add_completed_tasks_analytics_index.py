"""add completed task analytics index

Revision ID: 0015_completed_tasks_index
Revises: 0014_task_list_index
Create Date: 2026-05-15

Adds a composite partial index for completed-task analytics range queries.
"""

from __future__ import annotations

from alembic import op

revision = "0015_completed_tasks_index"
down_revision = "0014_task_list_index"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_tasks_completed_analytics
        ON tasks(user_id, status, completed_at DESC, id DESC)
        WHERE deleted_at IS NULL AND completed_at IS NOT NULL
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_tasks_completed_analytics")
