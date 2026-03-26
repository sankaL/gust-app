"""Add tasks pagination index for cursor-based pagination.

Revision ID: 0007_add_tasks_pagination_index
Revises: 0006
Create Date: 2026-03-26

Adds a composite index on tasks table to support efficient cursor-based
pagination when listing tasks across all groups or for a specific group.
The index covers (user_id, group_id, due_date, created_at, id) with a
partial filter for non-deleted open tasks.
"""

from __future__ import annotations

from alembic import op

revision = "0007_add_tasks_pagination_index"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create index for efficient cursor-based pagination on tasks
    # This index supports queries like:
    #   SELECT * FROM tasks WHERE user_id = ? AND status = 'open' AND deleted_at IS NULL
    #   ORDER BY created_at DESC, id DESC LIMIT 51
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_tasks_user_created_pagination
        ON tasks(user_id, created_at DESC, id DESC)
        WHERE deleted_at IS NULL AND status = 'open'
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_tasks_user_created_pagination")
