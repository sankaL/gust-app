from __future__ import annotations

import sqlalchemy as sa

metadata = sa.MetaData()

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

timestamp_default = sa.text("CURRENT_TIMESTAMP")

users = sa.Table(
    "users",
    metadata,
    sa.Column("id", sa.Uuid(as_uuid=False), primary_key=True),
    sa.Column("email", sa.Text(), nullable=False, unique=True),
    sa.Column("display_name", sa.Text(), nullable=True),
    sa.Column("timezone", sa.Text(), nullable=False),
    sa.Column(
        "created_at", sa.DateTime(timezone=True), nullable=False, server_default=timestamp_default
    ),
    sa.Column(
        "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=timestamp_default
    ),
)

groups = sa.Table(
    "groups",
    metadata,
    sa.Column("id", sa.Uuid(as_uuid=False), primary_key=True),
    sa.Column("user_id", sa.Uuid(as_uuid=False), sa.ForeignKey("users.id"), nullable=False),
    sa.Column("name", sa.Text(), nullable=False),
    sa.Column("description", sa.Text(), nullable=True),
    sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.false()),
    sa.Column("system_key", sa.Text(), nullable=True),
    sa.Column(
        "created_at", sa.DateTime(timezone=True), nullable=False, server_default=timestamp_default
    ),
    sa.Column(
        "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=timestamp_default
    ),
)

tasks = sa.Table(
    "tasks",
    metadata,
    sa.Column("id", sa.Uuid(as_uuid=False), primary_key=True),
    sa.Column("user_id", sa.Uuid(as_uuid=False), sa.ForeignKey("users.id"), nullable=False),
    sa.Column("group_id", sa.Uuid(as_uuid=False), sa.ForeignKey("groups.id"), nullable=False),
    sa.Column("capture_id", sa.Uuid(as_uuid=False), sa.ForeignKey("captures.id"), nullable=True),
    sa.Column("series_id", sa.Uuid(as_uuid=False), nullable=True),
    sa.Column("title", sa.Text(), nullable=False),
    sa.Column("status", task_status, nullable=False, server_default="open"),
    sa.Column("needs_review", sa.Boolean(), nullable=False, server_default=sa.false()),
    sa.Column("due_date", sa.Date(), nullable=True),
    sa.Column("reminder_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("reminder_offset_minutes", sa.Integer(), nullable=True),
    sa.Column("recurrence_frequency", recurrence_frequency, nullable=True),
    sa.Column("recurrence_interval", sa.Integer(), nullable=True),
    sa.Column("recurrence_weekday", sa.SmallInteger(), nullable=True),
    sa.Column("recurrence_day_of_month", sa.SmallInteger(), nullable=True),
    sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column(
        "created_at", sa.DateTime(timezone=True), nullable=False, server_default=timestamp_default
    ),
    sa.Column(
        "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=timestamp_default
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
        "(recurrence_frequency = 'daily' AND recurrence_weekday IS NULL "
        "AND recurrence_day_of_month IS NULL) "
        "OR (recurrence_frequency = 'weekly' AND recurrence_weekday IS NOT NULL "
        "AND recurrence_day_of_month IS NULL) "
        "OR (recurrence_frequency = 'monthly' AND recurrence_weekday IS NULL "
        "AND recurrence_day_of_month IS NOT NULL)))",
        name="ck_tasks_recurrence_shape",
    ),
)

subtasks = sa.Table(
    "subtasks",
    metadata,
    sa.Column("id", sa.Uuid(as_uuid=False), primary_key=True),
    sa.Column("task_id", sa.Uuid(as_uuid=False), sa.ForeignKey("tasks.id"), nullable=False),
    sa.Column("user_id", sa.Uuid(as_uuid=False), sa.ForeignKey("users.id"), nullable=False),
    sa.Column("title", sa.Text(), nullable=False),
    sa.Column("is_completed", sa.Boolean(), nullable=False, server_default=sa.false()),
    sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column(
        "created_at", sa.DateTime(timezone=True), nullable=False, server_default=timestamp_default
    ),
    sa.Column(
        "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=timestamp_default
    ),
    sa.CheckConstraint("length(trim(title)) > 0", name="ck_subtasks_title_not_blank"),
)

captures = sa.Table(
    "captures",
    metadata,
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
        "created_at", sa.DateTime(timezone=True), nullable=False, server_default=timestamp_default
    ),
    sa.Column(
        "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=timestamp_default
    ),
)

reminders = sa.Table(
    "reminders",
    metadata,
    sa.Column("id", sa.Uuid(as_uuid=False), primary_key=True),
    sa.Column("user_id", sa.Uuid(as_uuid=False), sa.ForeignKey("users.id"), nullable=False),
    sa.Column(
        "task_id", sa.Uuid(as_uuid=False), sa.ForeignKey("tasks.id"), nullable=False, unique=True
    ),
    sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=False),
    sa.Column("status", reminder_status, nullable=False),
    sa.Column("idempotency_key", sa.Text(), nullable=False, unique=True),
    sa.Column("claim_token", sa.Uuid(as_uuid=False), nullable=True),
    sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("claim_expires_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("send_attempt_count", sa.Integer(), nullable=False, server_default="0"),
    sa.Column("last_error_code", sa.Text(), nullable=True),
    sa.Column("provider_message_id", sa.Text(), nullable=True),
    sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
    sa.Column(
        "created_at", sa.DateTime(timezone=True), nullable=False, server_default=timestamp_default
    ),
    sa.Column(
        "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=timestamp_default
    ),
)

sa.Index(
    "uq_groups_user_lower_name",
    groups.c.user_id,
    sa.func.lower(groups.c.name),
    unique=True,
)
sa.Index(
    "uq_groups_user_system_key",
    groups.c.user_id,
    groups.c.system_key,
    unique=True,
    sqlite_where=groups.c.system_key.is_not(None),
)
sa.Index("ix_tasks_user_status_group", tasks.c.user_id, tasks.c.status, tasks.c.group_id)
sa.Index("ix_tasks_user_needs_review", tasks.c.user_id, tasks.c.needs_review)
sa.Index("ix_tasks_user_due_date", tasks.c.user_id, tasks.c.due_date)
sa.Index("ix_tasks_series_status", tasks.c.series_id, tasks.c.status)
sa.Index("ix_subtasks_task_id", subtasks.c.task_id)
sa.Index("ix_captures_user_created_at", captures.c.user_id, captures.c.created_at.desc())
sa.Index("ix_captures_expires_at", captures.c.expires_at)
sa.Index("ix_reminders_status_scheduled_for", reminders.c.status, reminders.c.scheduled_for)
sa.Index("ix_reminders_claim_expires_at", reminders.c.claim_expires_at)
