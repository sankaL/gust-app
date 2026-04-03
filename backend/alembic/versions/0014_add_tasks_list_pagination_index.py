"""add task list pagination index

Revision ID: 0014_task_list_index
Revises: 0013_add_yearly_recurrence
Create Date: 2026-04-03

Adds a composite partial index to support efficient cursor-based pagination
when listing open tasks. The index covers the common query pattern:
  WHERE user_id = ? AND status = 'open' AND deleted_at IS NULL
  ORDER BY created_at DESC, id DESC
"""

from __future__ import annotations

from alembic import op

revision = "0014_task_list_index"
down_revision = "0013_add_yearly_recurrence"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    # Create composite partial index for efficient task list pagination
    # This index directly supports queries like:
    #   SELECT * FROM tasks
    #   WHERE user_id = ? AND status = 'open' AND deleted_at IS NULL
    #   ORDER BY created_at DESC, id DESC
    #   LIMIT ?
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_tasks_list_pagination
        ON tasks(user_id, status, created_at DESC, id DESC)
        WHERE deleted_at IS NULL
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_tasks_list_pagination")
