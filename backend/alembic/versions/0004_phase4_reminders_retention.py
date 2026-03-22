from __future__ import annotations

"""phase 4 reminders retention

Revision ID: 0004_phase4_reminders_retention
Revises: 0003_phase2_capture_extraction
Create Date: 2026-03-22 22:15:00.000000
"""

from typing import Optional, Sequence

from alembic import op

revision: str = "0004_phase4_reminders_retention"
down_revision: Optional[str] = "0003_phase2_capture_extraction"
branch_labels: Optional[Sequence[str]] = None
depends_on: Optional[Sequence[str]] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.drop_constraint("tasks_capture_id_fkey", "tasks", type_="foreignkey")
    op.create_foreign_key(
        "tasks_capture_id_fkey",
        "tasks",
        "captures",
        ["capture_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.drop_constraint("tasks_capture_id_fkey", "tasks", type_="foreignkey")
    op.create_foreign_key(
        "tasks_capture_id_fkey",
        "tasks",
        "captures",
        ["capture_id"],
        ["id"],
    )
