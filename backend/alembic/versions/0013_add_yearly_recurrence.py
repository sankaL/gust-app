"""add_yearly_recurrence

Revision ID: 0013_add_yearly_recurrence
Revises: 0012_harden_backend_table_grants
Create Date: 2026-04-03

Adds yearly recurrence support with recurrence_month column to tasks and extracted_tasks tables.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0013_add_yearly_recurrence"
down_revision = "0012_harden_backend_table_grants"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    # Add recurrence_month column to tasks table
    op.add_column("tasks", sa.Column("recurrence_month", sa.SmallInteger(), nullable=True))

    # Add recurrence_month column to extracted_tasks table
    op.add_column("extracted_tasks", sa.Column("recurrence_month", sa.SmallInteger(), nullable=True))

    # Drop existing check constraint
    op.drop_constraint("ck_tasks_recurrence_shape", "tasks", type_="check")

    # Create new check constraint with yearly support
    op.create_check_constraint(
        "ck_tasks_recurrence_shape",
        "tasks",
        "(recurrence_frequency IS NULL AND recurrence_interval IS NULL "
        "AND recurrence_weekday IS NULL AND recurrence_day_of_month IS NULL "
        "AND recurrence_month IS NULL) "
        "OR (recurrence_interval = 1 AND ("
        "(recurrence_frequency = 'daily' AND recurrence_weekday IS NULL "
        "AND recurrence_day_of_month IS NULL AND recurrence_month IS NULL) "
        "OR (recurrence_frequency = 'weekly' AND recurrence_weekday IS NOT NULL "
        "AND recurrence_day_of_month IS NULL AND recurrence_month IS NULL) "
        "OR (recurrence_frequency = 'monthly' AND recurrence_weekday IS NULL "
        "AND recurrence_day_of_month IS NOT NULL AND recurrence_month IS NULL) "
        "OR (recurrence_frequency = 'yearly' AND recurrence_weekday IS NULL "
        "AND recurrence_day_of_month IS NOT NULL AND recurrence_month IS NOT NULL)))",
    )


def downgrade() -> None:
    # Drop new check constraint
    op.drop_constraint("ck_tasks_recurrence_shape", "tasks", type_="check")

    # Restore original check constraint (without yearly)
    op.create_check_constraint(
        "ck_tasks_recurrence_shape",
        "tasks",
        "(recurrence_frequency IS NULL AND recurrence_interval IS NULL "
        "AND recurrence_weekday IS NULL AND recurrence_day_of_month IS NULL) "
        "OR (recurrence_interval = 1 AND ("
        "(recurrence_frequency = 'daily' AND recurrence_weekday IS NULL "
        "AND recurrence_day_of_month IS NULL) "
        "OR (recurrence_frequency = 'weekly' AND recurrence_weekday IS NOT NULL "
        "AND recurrence_day_of_month IS NULL) "
        "OR (recurrence_frequency = 'monthly' AND recurrence_weekday IS NULL "
        "AND recurrence_day_of_month IS NOT NULL)))",
    )

    # Drop recurrence_month columns
    op.drop_column("extracted_tasks", "recurrence_month")
    op.drop_column("tasks", "recurrence_month")
