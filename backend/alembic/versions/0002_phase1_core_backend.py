from __future__ import annotations

"""phase 1 core backend

Revision ID: 0002_phase1_core_backend
Revises: 0001_phase0_baseline
Create Date: 2026-03-22 16:00:00.000000
"""

from typing import Optional, Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_phase1_core_backend"
down_revision: Optional[str] = "0001_phase0_baseline"
branch_labels: Optional[Sequence[str]] = None
depends_on: Optional[Sequence[str]] = None


task_status = sa.Enum("open", "completed", name="task_status", native_enum=False)
capture_status = sa.Enum(
    "pending_transcription",
    "transcription_failed",
    "ready_for_review",
    "submitted",
    "extraction_failed",
    "completed",
    name="capture_status",
    native_enum=False,
)
reminder_status = sa.Enum(
    "pending",
    "claimed",
    "sent",
    "cancelled",
    "failed",
    name="reminder_status",
    native_enum=False,
)
recurrence_frequency = sa.Enum(
    "daily",
    "weekly",
    "monthly",
    name="recurrence_frequency",
    native_enum=False,
)


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(as_uuid=False), primary_key=True),
        sa.Column("email", sa.Text(), nullable=False, unique=True),
        sa.Column("display_name", sa.Text(), nullable=True),
        sa.Column("timezone", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )

    op.create_table(
        "groups",
        sa.Column("id", sa.Uuid(as_uuid=False), primary_key=True),
        sa.Column("user_id", sa.Uuid(as_uuid=False), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("system_key", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )

    op.create_table(
        "captures",
        sa.Column("id", sa.Uuid(as_uuid=False), primary_key=True),
        sa.Column("user_id", sa.Uuid(as_uuid=False), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("input_type", sa.Text(), nullable=False),
        sa.Column("status", capture_status, nullable=False),
        sa.Column("source_text", sa.Text(), nullable=True),
        sa.Column("transcript_text", sa.Text(), nullable=True),
        sa.Column("transcript_edited_text", sa.Text(), nullable=True),
        sa.Column("transcription_provider", sa.Text(), nullable=True),
        sa.Column("transcription_latency_ms", sa.Integer(), nullable=True),
        sa.Column("extraction_attempt_count", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("tasks_created_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tasks_skipped_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_code", sa.Text(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )

    op.create_table(
        "tasks",
        sa.Column("id", sa.Uuid(as_uuid=False), primary_key=True),
        sa.Column("user_id", sa.Uuid(as_uuid=False), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("group_id", sa.Uuid(as_uuid=False), sa.ForeignKey("groups.id"), nullable=False),
        sa.Column("capture_id", sa.Uuid(as_uuid=False), sa.ForeignKey("captures.id"), nullable=True),
        sa.Column("series_id", sa.Uuid(as_uuid=False), nullable=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("status", task_status, nullable=False, server_default="open"),
        sa.Column("needs_review", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("reminder_offset_minutes", sa.Integer(), nullable=True),
        sa.Column("recurrence_frequency", recurrence_frequency, nullable=True),
        sa.Column("recurrence_interval", sa.Integer(), nullable=True),
        sa.Column("recurrence_weekday", sa.SmallInteger(), nullable=True),
        sa.Column("recurrence_day_of_month", sa.SmallInteger(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.CheckConstraint("length(trim(title)) > 0", name="ck_tasks_title_not_blank"),
        sa.CheckConstraint(
            "(status = 'completed' AND completed_at IS NOT NULL) "
            "OR (status = 'open' AND completed_at IS NULL)",
            name="ck_tasks_completed_at_matches_status",
        ),
        sa.CheckConstraint(
            "(recurrence_frequency IS NULL AND recurrence_interval IS NULL "
            "AND recurrence_weekday IS NULL AND recurrence_day_of_month IS NULL) "
            "OR (recurrence_interval = 1 AND ("
            "(recurrence_frequency = 'daily' AND recurrence_weekday IS NULL AND recurrence_day_of_month IS NULL) "
            "OR (recurrence_frequency = 'weekly' AND recurrence_weekday IS NOT NULL "
            "AND recurrence_day_of_month IS NULL) "
            "OR (recurrence_frequency = 'monthly' AND recurrence_weekday IS NULL "
            "AND recurrence_day_of_month IS NOT NULL)))",
            name="ck_tasks_recurrence_shape",
        ),
    )

    op.create_table(
        "subtasks",
        sa.Column("id", sa.Uuid(as_uuid=False), primary_key=True),
        sa.Column("task_id", sa.Uuid(as_uuid=False), sa.ForeignKey("tasks.id"), nullable=False),
        sa.Column("user_id", sa.Uuid(as_uuid=False), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("is_completed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.CheckConstraint("length(trim(title)) > 0", name="ck_subtasks_title_not_blank"),
    )

    op.create_table(
        "reminders",
        sa.Column("id", sa.Uuid(as_uuid=False), primary_key=True),
        sa.Column("user_id", sa.Uuid(as_uuid=False), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("task_id", sa.Uuid(as_uuid=False), sa.ForeignKey("tasks.id"), nullable=False),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", reminder_status, nullable=False),
        sa.Column("idempotency_key", sa.Text(), nullable=False),
        sa.Column("claim_token", sa.Uuid(as_uuid=False), nullable=True),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("claim_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("send_attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error_code", sa.Text(), nullable=True),
        sa.Column("provider_message_id", sa.Text(), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.UniqueConstraint("task_id", name="uq_reminders_task_id"),
        sa.UniqueConstraint("idempotency_key", name="uq_reminders_idempotency_key"),
    )

    op.create_index(
        "uq_groups_user_lower_name",
        "groups",
        ["user_id", sa.text("lower(name)")],
        unique=True,
    )
    op.create_index(
        "uq_groups_user_system_key",
        "groups",
        ["user_id", "system_key"],
        unique=True,
        postgresql_where=sa.text("system_key IS NOT NULL"),
        sqlite_where=sa.text("system_key IS NOT NULL"),
    )
    op.create_index("ix_tasks_user_status_group", "tasks", ["user_id", "status", "group_id"])
    op.create_index("ix_tasks_user_needs_review", "tasks", ["user_id", "needs_review"])
    op.create_index("ix_tasks_user_due_date", "tasks", ["user_id", "due_date"])
    op.create_index("ix_tasks_series_status", "tasks", ["series_id", "status"])
    op.create_index("ix_subtasks_task_id", "subtasks", ["task_id"])
    op.create_index("ix_captures_user_created_at", "captures", ["user_id", sa.text("created_at DESC")])
    op.create_index("ix_captures_expires_at", "captures", ["expires_at"])
    op.create_index(
        "ix_reminders_status_scheduled_for",
        "reminders",
        ["status", "scheduled_for"],
    )
    op.create_index("ix_reminders_claim_expires_at", "reminders", ["claim_expires_at"])


def downgrade() -> None:
    op.drop_index("ix_reminders_claim_expires_at", table_name="reminders")
    op.drop_index("ix_reminders_status_scheduled_for", table_name="reminders")
    op.drop_index("ix_captures_expires_at", table_name="captures")
    op.drop_index("ix_captures_user_created_at", table_name="captures")
    op.drop_index("ix_subtasks_task_id", table_name="subtasks")
    op.drop_index("ix_tasks_series_status", table_name="tasks")
    op.drop_index("ix_tasks_user_due_date", table_name="tasks")
    op.drop_index("ix_tasks_user_needs_review", table_name="tasks")
    op.drop_index("ix_tasks_user_status_group", table_name="tasks")
    op.drop_index("uq_groups_user_system_key", table_name="groups")
    op.drop_index("uq_groups_user_lower_name", table_name="groups")

    op.drop_table("reminders")
    op.drop_table("subtasks")
    op.drop_table("tasks")
    op.drop_table("captures")
    op.drop_table("groups")
    op.drop_table("users")
