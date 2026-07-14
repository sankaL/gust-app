"""Harden RLS parent ownership and rate-limit counter constraints.

Revision ID: 0016_harden_rls_relationships
Revises: 0015_completed_tasks_index
Create Date: 2026-07-14 12:00:00.000000
"""

from __future__ import annotations

from typing import Optional, Sequence

from alembic import op

revision: str = "0016_harden_rls_relationships"
down_revision: Optional[str] = "0015_completed_tasks_index"
branch_labels: Optional[Sequence[str]] = None
depends_on: Optional[Sequence[str]] = None

ACTOR_POLICY_CHECKS: dict[str, str] = {
    "users": "{actor_id} = id",
    "groups": "{actor_id} = user_id",
    "captures": "{actor_id} = user_id",
    "tasks": (
        "{actor_id} = user_id "
        "AND EXISTS (SELECT 1 FROM public.groups AS owner_group "
        "WHERE owner_group.id = group_id AND owner_group.user_id = {actor_id}) "
        "AND (capture_id IS NULL OR EXISTS (SELECT 1 FROM public.captures AS owner_capture "
        "WHERE owner_capture.id = capture_id AND owner_capture.user_id = {actor_id}))"
    ),
    "subtasks": (
        "{actor_id} = user_id "
        "AND EXISTS (SELECT 1 FROM public.tasks AS owner_task "
        "WHERE owner_task.id = task_id AND owner_task.user_id = {actor_id})"
    ),
    "reminders": (
        "{actor_id} = user_id "
        "AND EXISTS (SELECT 1 FROM public.tasks AS owner_task "
        "WHERE owner_task.id = task_id AND owner_task.user_id = {actor_id})"
    ),
    "extracted_tasks": (
        "{actor_id} = user_id "
        "AND EXISTS (SELECT 1 FROM public.captures AS owner_capture "
        "WHERE owner_capture.id = capture_id AND owner_capture.user_id = {actor_id}) "
        "AND EXISTS (SELECT 1 FROM public.groups AS owner_group "
        "WHERE owner_group.id = group_id AND owner_group.user_id = {actor_id})"
    ),
    "digest_dispatches": "{actor_id} = user_id",
}


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute(
        "LOCK TABLE public.groups, public.captures, public.tasks, public.subtasks, "
        "public.reminders, public.extracted_tasks IN SHARE ROW EXCLUSIVE MODE"
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM public.tasks AS child
                JOIN public.groups AS parent ON parent.id = child.group_id
                WHERE child.user_id IS DISTINCT FROM parent.user_id
            ) THEN
                RAISE EXCEPTION 'RLS preflight failed: tasks reference cross-owner groups';
            END IF;
            IF EXISTS (
                SELECT 1 FROM public.tasks AS child
                JOIN public.captures AS parent ON parent.id = child.capture_id
                WHERE child.capture_id IS NOT NULL
                  AND child.user_id IS DISTINCT FROM parent.user_id
            ) THEN
                RAISE EXCEPTION 'RLS preflight failed: tasks reference cross-owner captures';
            END IF;
            IF EXISTS (
                SELECT 1 FROM public.subtasks AS child
                JOIN public.tasks AS parent ON parent.id = child.task_id
                WHERE child.user_id IS DISTINCT FROM parent.user_id
            ) THEN
                RAISE EXCEPTION 'RLS preflight failed: subtasks reference cross-owner tasks';
            END IF;
            IF EXISTS (
                SELECT 1 FROM public.reminders AS child
                JOIN public.tasks AS parent ON parent.id = child.task_id
                WHERE child.user_id IS DISTINCT FROM parent.user_id
            ) THEN
                RAISE EXCEPTION 'RLS preflight failed: reminders reference cross-owner tasks';
            END IF;
            IF EXISTS (
                SELECT 1 FROM public.extracted_tasks AS child
                JOIN public.captures AS parent ON parent.id = child.capture_id
                WHERE child.user_id IS DISTINCT FROM parent.user_id
            ) THEN
                RAISE EXCEPTION 'RLS preflight failed: extracted tasks reference cross-owner captures';
            END IF;
            IF EXISTS (
                SELECT 1 FROM public.extracted_tasks AS child
                JOIN public.groups AS parent ON parent.id = child.group_id
                WHERE child.user_id IS DISTINCT FROM parent.user_id
            ) THEN
                RAISE EXCEPTION 'RLS preflight failed: extracted tasks reference cross-owner groups';
            END IF;
        END
        $$
        """
    )

    for table_name, owner_check_template in ACTOR_POLICY_CHECKS.items():
        actor_id = "NULLIF(current_setting('app.current_user_id', true), '')::uuid"
        owner_check = owner_check_template.format(actor_id=actor_id)
        policy_check = (
            "(current_setting('app.internal_job', true) = 'true') "
            f"OR ({owner_check})"
        )
        policy_name = f"{table_name}_actor_rls"

        op.execute(f"ALTER TABLE public.{table_name} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE public.{table_name} FORCE ROW LEVEL SECURITY")
        op.execute(f"DROP POLICY IF EXISTS {policy_name} ON public.{table_name}")
        op.execute(
            f"CREATE POLICY {policy_name} ON public.{table_name} "
            f"AS PERMISSIVE FOR ALL TO PUBLIC USING ({policy_check}) WITH CHECK ({policy_check})"
        )

    op.execute(
        "ALTER TABLE public.rate_limit_counters "
        "ADD CONSTRAINT ck_rate_limit_counters_scope_length "
        "CHECK (length(scope) BETWEEN 1 AND 100) NOT VALID"
    )
    op.execute(
        "ALTER TABLE public.rate_limit_counters "
        "ADD CONSTRAINT ck_rate_limit_counters_subject_length "
        "CHECK (length(subject_key) BETWEEN 1 AND 300) NOT VALID"
    )
    op.execute(
        "ALTER TABLE public.rate_limit_counters "
        "ADD CONSTRAINT ck_rate_limit_counters_valid_window "
        "CHECK (window_seconds > 0 OR "
        "(window_seconds = 0 AND scope LIKE 'action_lock:%')) NOT VALID"
    )
    op.execute(
        "ALTER TABLE public.rate_limit_counters "
        "ADD CONSTRAINT ck_rate_limit_counters_nonnegative_count "
        "CHECK (request_count >= 0) NOT VALID"
    )
    for constraint_name in (
        "ck_rate_limit_counters_scope_length",
        "ck_rate_limit_counters_subject_length",
        "ck_rate_limit_counters_valid_window",
        "ck_rate_limit_counters_nonnegative_count",
    ):
        op.execute(
            "ALTER TABLE public.rate_limit_counters "
            f"VALIDATE CONSTRAINT {constraint_name}"
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    op.execute(
        "ALTER TABLE public.rate_limit_counters "
        "DROP CONSTRAINT IF EXISTS ck_rate_limit_counters_nonnegative_count"
    )
    op.execute(
        "ALTER TABLE public.rate_limit_counters "
        "DROP CONSTRAINT IF EXISTS ck_rate_limit_counters_valid_window"
    )
    op.execute(
        "ALTER TABLE public.rate_limit_counters "
        "DROP CONSTRAINT IF EXISTS ck_rate_limit_counters_subject_length"
    )
    op.execute(
        "ALTER TABLE public.rate_limit_counters "
        "DROP CONSTRAINT IF EXISTS ck_rate_limit_counters_scope_length"
    )

    for table_name, owner_check_template in ACTOR_POLICY_CHECKS.items():
        actor_id = "current_setting('app.current_user_id', true)::uuid"
        owner_check = owner_check_template.split(" AND EXISTS", maxsplit=1)[0].format(
            actor_id=actor_id
        )
        policy_check = (
            "(current_setting('app.internal_job', true) = 'true') "
            f"OR ({owner_check})"
        )
        policy_name = f"{table_name}_actor_rls"
        op.execute(f"DROP POLICY IF EXISTS {policy_name} ON public.{table_name}")
        op.execute(
            f"CREATE POLICY {policy_name} ON public.{table_name} "
            f"FOR ALL USING ({policy_check}) WITH CHECK ({policy_check})"
        )
