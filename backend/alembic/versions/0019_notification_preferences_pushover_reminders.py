"""Add per-user notification preferences and precise reminder support.

Revision ID: 0019_notification_preferences_pushover_reminders
Revises: 0018_ensure_allowed_users
Create Date: 2026-08-15 10:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0019_notification_preferences_pushover_reminders"
down_revision: str | None = "0018_ensure_allowed_users"
branch_labels: tuple[str, ...] | None = None
depends_on: tuple[str, ...] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    schema = "public" if bind.dialect.name == "postgresql" else None

    op.create_table(
        "notification_preferences",
        sa.Column(
            "user_id",
            sa.Uuid(as_uuid=False),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("email_daily_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("email_weekly_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("pushover_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("pushover_task_reminders_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("pushover_daily_digest_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("pushover_weekly_digest_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("date_only_reminder_time", sa.Time(), nullable=False, server_default=sa.text("'08:00:00'")),
        sa.Column("pushover_user_key_encrypted", sa.Text(), nullable=True),
        sa.Column("pushover_user_key_hint", sa.String(length=12), nullable=True),
        sa.Column("pushover_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("pushover_connection_error_code", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        schema=schema,
    )
    op.execute(
        "INSERT INTO notification_preferences (user_id) SELECT id FROM users "
        "ON CONFLICT (user_id) DO NOTHING"
    )

    with op.batch_alter_table("tasks", schema=schema) as batch:
        batch.add_column(sa.Column("reminder_date", sa.Date(), nullable=True))
        batch.create_check_constraint(
            "ck_tasks_reminder_precision",
            "NOT (reminder_at IS NOT NULL AND reminder_date IS NOT NULL)",
        )
    with op.batch_alter_table("extracted_tasks", schema=schema) as batch:
        batch.add_column(sa.Column("reminder_date", sa.Date(), nullable=True))
        batch.create_check_constraint(
            "ck_extracted_tasks_reminder_precision",
            "NOT (reminder_at IS NOT NULL AND reminder_date IS NOT NULL)",
        )
    with op.batch_alter_table("reminders", schema=schema) as batch:
        batch.add_column(sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE reminders SET next_attempt_at = scheduled_for WHERE next_attempt_at IS NULL")
    op.create_index("ix_reminders_status_next_attempt_at", "reminders", ["status", "next_attempt_at"], schema=schema)

    with op.batch_alter_table("digest_dispatches", schema=schema) as batch:
        batch.add_column(
            sa.Column("channel", sa.String(length=16), nullable=False, server_default=sa.text("'email'"))
        )
        batch.drop_index("uq_digest_dispatches_user_period")
        batch.create_index(
            "uq_digest_dispatches_user_period_channel",
            ["user_id", "digest_type", "period_start_date", "period_end_date", "channel"],
            unique=True,
        )

    if bind.dialect.name == "postgresql":
        op.execute("ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE public.notification_preferences FORCE ROW LEVEL SECURITY")
        op.execute(
            "CREATE POLICY notification_preferences_actor_rls ON public.notification_preferences "
            "AS PERMISSIVE FOR ALL TO PUBLIC "
            "USING ((current_setting('app.internal_job', true) = 'true') "
            "OR (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)) "
            "WITH CHECK ((current_setting('app.internal_job', true) = 'true') "
            "OR (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid))"
        )
        op.execute("REVOKE ALL PRIVILEGES ON TABLE public.notification_preferences FROM PUBLIC")
        op.execute(
            "DO $$ BEGIN "
            "IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN "
            "REVOKE ALL PRIVILEGES ON TABLE public.notification_preferences FROM anon; END IF; "
            "IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN "
            "REVOKE ALL PRIVILEGES ON TABLE public.notification_preferences FROM authenticated; END IF; "
            "IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gust_app_runtime') THEN "
            "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notification_preferences TO gust_app_runtime; END IF; "
            "END $$;"
        )


def downgrade() -> None:
    # Preference rows contain encrypted third-party credentials. Retain them rather
    # than deleting user configuration during an application rollback.
    return
