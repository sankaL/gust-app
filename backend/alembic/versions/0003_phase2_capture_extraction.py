from __future__ import annotations

"""phase 2 capture extraction

Revision ID: 0003_phase2_capture_extraction
Revises: 0002_phase1_core_backend
Create Date: 2026-03-22 19:20:00.000000
"""

from typing import Optional, Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_phase2_capture_extraction"
down_revision: Optional[str] = "0002_phase1_core_backend"
branch_labels: Optional[Sequence[str]] = None
depends_on: Optional[Sequence[str]] = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("reminder_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("tasks", "reminder_at")
