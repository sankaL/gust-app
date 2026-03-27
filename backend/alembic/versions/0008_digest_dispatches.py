"""Add digest dispatch tracking and disable legacy per-item pending reminders.

Revision ID: 0008_digest_dispatches
Revises: 0007_add_tasks_pagination_index
Create Date: 2026-03-27
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0008_digest_dispatches"
down_revision = "0007_add_tasks_pagination_index"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "digest_dispatches",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("digest_type", sa.Text(), nullable=False),
        sa.Column("period_start_date", sa.Date(), nullable=False),
        sa.Column("period_end_date", sa.Date(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("idempotency_key", sa.Text(), nullable=False),
        sa.Column("provider_message_id", sa.Text(), nullable=True),
        sa.Column("last_error_code", sa.Text(), nullable=True),
        sa.Column("attempted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("digest_type IN ('daily', 'weekly')", name="ck_digest_dispatches_type"),
        sa.CheckConstraint(
            "status IN ('sent', 'failed', 'skipped_empty')",
            name="ck_digest_dispatches_status",
        ),
    )
    op.create_index(
        "uq_digest_dispatches_user_period",
        "digest_dispatches",
        ["user_id", "digest_type", "period_start_date", "period_end_date"],
        unique=True,
    )
    op.create_index(
        "ix_digest_dispatches_type_period",
        "digest_dispatches",
        ["digest_type", "period_start_date", "period_end_date"],
        unique=False,
    )
    op.create_index(
        "ix_digest_dispatches_idempotency_key",
        "digest_dispatches",
        ["idempotency_key"],
        unique=True,
    )

    # One-time cutover: disable legacy pending/claimed per-item reminder sends.
    op.execute(
        """
        UPDATE reminders
           SET status = 'cancelled',
               claim_token = NULL,
               claimed_at = NULL,
               claim_expires_at = NULL,
               cancelled_at = COALESCE(cancelled_at, CURRENT_TIMESTAMP),
               updated_at = CURRENT_TIMESTAMP
         WHERE status IN ('pending', 'claimed')
        """
    )


def downgrade() -> None:
    op.drop_index("ix_digest_dispatches_idempotency_key", table_name="digest_dispatches")
    op.drop_index("ix_digest_dispatches_type_period", table_name="digest_dispatches")
    op.drop_index("uq_digest_dispatches_user_period", table_name="digest_dispatches")
    op.drop_table("digest_dispatches")
