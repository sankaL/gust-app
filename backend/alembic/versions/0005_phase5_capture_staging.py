from __future__ import annotations

"""phase 5 capture staging

Revision ID: 0005_phase5_capture_staging
Revises: 0004_phase4_reminders_retention
Create Date: 2026-03-23 21:07:00.000000
"""

from typing import Optional, Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005_phase5_capture_staging"
down_revision: Optional[str] = "0004_phase4_reminders_retention"
branch_labels: Optional[Sequence[str]] = None
depends_on: Optional[Sequence[str]] = None


def upgrade() -> None:
    # Create extracted_tasks table
    op.create_table(
        "extracted_tasks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("capture_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("captures.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("group_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("group_name", sa.Text(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("reminder_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("recurrence_frequency", sa.Text(), nullable=True),
        sa.Column("recurrence_weekday", sa.SmallInteger(), nullable=True),
        sa.Column("recurrence_day_of_month", sa.SmallInteger(), nullable=True),
        sa.Column("top_confidence", sa.Float(), nullable=False),
        sa.Column("needs_review", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    # Create indexes
    op.create_index("idx_extracted_tasks_user_id", "extracted_tasks", ["user_id"])
    op.create_index("idx_extracted_tasks_capture_id", "extracted_tasks", ["capture_id"])
    op.create_index("idx_extracted_tasks_status", "extracted_tasks", ["user_id", "status"])


def downgrade() -> None:
    op.drop_index("idx_extracted_tasks_status", table_name="extracted_tasks")
    op.drop_index("idx_extracted_tasks_capture_id", table_name="extracted_tasks")
    op.drop_index("idx_extracted_tasks_user_id", table_name="extracted_tasks")
    op.drop_table("extracted_tasks")
