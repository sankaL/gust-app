"""Add optional descriptions to tasks and extracted tasks.

Revision ID: 0009_task_descriptions
Revises: 0008_digest_dispatches
Create Date: 2026-03-27
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0009_task_descriptions"
down_revision = "0008_digest_dispatches"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("description", sa.Text(), nullable=True))
    op.add_column("extracted_tasks", sa.Column("description", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("extracted_tasks", "description")
    op.drop_column("tasks", "description")
