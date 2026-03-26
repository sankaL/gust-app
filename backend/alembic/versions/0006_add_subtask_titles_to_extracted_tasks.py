"""Add subtask_titles JSON column to extracted_tasks.

Revision ID: 0006
Revises: 0005
Create Date: 2026-03-24

Adds a nullable JSON column to store the ordered list of subtask titles
extracted from a transcript before the task is approved and real subtask
rows are created in the subtasks table.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005_phase5_capture_staging"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "extracted_tasks",
        sa.Column("subtask_titles", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("extracted_tasks", "subtask_titles")
