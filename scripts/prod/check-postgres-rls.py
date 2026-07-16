#!/usr/bin/env python3

from __future__ import annotations

import argparse
import os
import sys

import psycopg

TABLE_NAMES = (
    "users",
    "groups",
    "captures",
    "tasks",
    "subtasks",
    "reminders",
    "extracted_tasks",
    "digest_dispatches",
)
POLICY_REQUIRED_FRAGMENTS = {
    "tasks": ("owner_group.id = tasks.group_id", "owner_capture.id = tasks.capture_id"),
    "subtasks": ("owner_task.id = subtasks.task_id",),
    "reminders": ("owner_task.id = reminders.task_id",),
    "extracted_tasks": (
        "owner_capture.id = extracted_tasks.capture_id",
        "owner_group.id = extracted_tasks.group_id",
    ),
}


def _psycopg_database_url(database_url: str) -> str:
    """Convert SQLAlchemy's explicit psycopg scheme to a libpq-compatible URL."""
    return database_url.replace("postgresql+psycopg://", "postgresql://", 1)


def main() -> int:  # noqa: C901
    parser = argparse.ArgumentParser(
        description="Verify the current Postgres role and Gust tables are configured for RLS."
    )
    parser.add_argument(
        "--database-url",
        default=os.getenv("DATABASE_URL"),
        help="Postgres connection string. Defaults to DATABASE_URL.",
    )
    args = parser.parse_args()

    if not args.database_url:
        print("DATABASE_URL is required.", file=sys.stderr)
        return 1

    with (
        psycopg.connect(_psycopg_database_url(args.database_url)) as connection,
        connection.cursor() as cursor,
    ):
            cursor.execute(
                """
                SELECT current_user, rolbypassrls
                  FROM pg_roles
                 WHERE rolname = current_user
                """
            )
            role_row = cursor.fetchone()
            if role_row is None:
                print("Could not resolve the current Postgres role.", file=sys.stderr)
                return 1

            role_name, bypass_rls = role_row
            print(f"current_user={role_name}")
            print(f"rolbypassrls={str(bool(bypass_rls)).lower()}")
            if bypass_rls:
                print(
                    "FAIL: current Postgres role has BYPASSRLS and will ignore table policies.",
                    file=sys.stderr,
                )
                return 1

            cursor.execute(
                """
                SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
                  FROM pg_class AS c
                  JOIN pg_namespace AS n
                    ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public'
                   AND c.relname = ANY(%s)
                 ORDER BY c.relname
                """,
                (list(TABLE_NAMES),),
            )
            table_rows = {row[0]: row[1:] for row in cursor.fetchall()}

            missing_tables = sorted(set(TABLE_NAMES) - set(table_rows))
            if missing_tables:
                print(
                    f"FAIL: missing expected tables in public schema: {', '.join(missing_tables)}",
                    file=sys.stderr,
                )
                return 1

            failed_tables: list[str] = []
            for table_name in TABLE_NAMES:
                row_security_enabled, force_row_security = table_rows[table_name]
                print(
                    f"{table_name}: row_security={str(bool(row_security_enabled)).lower()} "
                    f"force_row_security={str(bool(force_row_security)).lower()}"
                )
                if not row_security_enabled or not force_row_security:
                    failed_tables.append(table_name)

            if failed_tables:
                print(
                    "FAIL: RLS is not fully enabled/forced on: "
                    + ", ".join(sorted(failed_tables)),
                    file=sys.stderr,
                )
                return 1

            cursor.execute(
                """
                SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
                  FROM pg_policies
                 WHERE schemaname = 'public'
                   AND tablename = ANY(%s)
                """,
                (list(TABLE_NAMES),),
            )
            policies_by_table: dict[str, list[tuple[object, ...]]] = {}
            for policy_row in cursor.fetchall():
                policies_by_table.setdefault(policy_row[0], []).append(policy_row[1:])

            missing_policies = [
                table_name
                for table_name in TABLE_NAMES
                if not any(
                    row[0] == f"{table_name}_actor_rls"
                    for row in policies_by_table.get(table_name, [])
                )
            ]
            if missing_policies:
                print(
                    "FAIL: missing actor RLS policies on: " + ", ".join(sorted(missing_policies)),
                    file=sys.stderr,
                )
                return 1

            invalid_policies: list[str] = []
            for table_name in TABLE_NAMES:
                policy = next(
                    row
                    for row in policies_by_table[table_name]
                    if row[0] == f"{table_name}_actor_rls"
                )
                (
                    _policy_name,
                    permissive,
                    roles,
                    command,
                    using_expression,
                    check_expression,
                ) = policy
                normalized_using = " ".join(str(using_expression or "").split()).lower()
                normalized_check = " ".join(str(check_expression or "").split()).lower()
                required_fragments = (
                    "current_setting('app.current_user_id'::text, true)",
                    *POLICY_REQUIRED_FRAGMENTS.get(table_name, ()),
                )
                fragments_present = all(
                    fragment.lower() in normalized_using and fragment.lower() in normalized_check
                    for fragment in required_fragments
                )
                if (
                    permissive != "PERMISSIVE"
                    or roles != ["public"]
                    or command != "ALL"
                    or not fragments_present
                ):
                    invalid_policies.append(table_name)

            if invalid_policies:
                print(
                    "FAIL: actor RLS policy definitions are incomplete on: "
                    + ", ".join(sorted(invalid_policies)),
                    file=sys.stderr,
                )
                return 1

            cursor.execute(
                """
                SELECT rolname,
                       has_table_privilege(rolname, 'public.rate_limit_counters', 'SELECT')
                       OR has_table_privilege(rolname, 'public.rate_limit_counters', 'INSERT')
                       OR has_table_privilege(rolname, 'public.rate_limit_counters', 'UPDATE')
                       OR has_table_privilege(rolname, 'public.rate_limit_counters', 'DELETE')
                  FROM pg_roles
                 WHERE rolname IN ('anon', 'authenticated')
                """
            )
            exposed_operational_roles = [
                role_name for role_name, has_privilege in cursor.fetchall() if has_privilege
            ]
            if exposed_operational_roles:
                print(
                    "FAIL: rate_limit_counters is exposed to: "
                    + ", ".join(sorted(exposed_operational_roles)),
                    file=sys.stderr,
                )
                return 1

            cursor.execute("SELECT count(*) FROM public.alembic_version")
            visible_revision_rows = cursor.fetchone()[0]
            if visible_revision_rows != 1:
                print(
                    "FAIL: runtime role cannot see exactly one Alembic revision row.",
                    file=sys.stderr,
                )
                return 1

            cursor.execute(
                """
                SELECT rolname,
                       has_table_privilege(rolname, 'public.alembic_version', 'SELECT')
                       OR has_table_privilege(rolname, 'public.alembic_version', 'INSERT')
                       OR has_table_privilege(rolname, 'public.alembic_version', 'UPDATE')
                       OR has_table_privilege(rolname, 'public.alembic_version', 'DELETE')
                  FROM pg_roles
                 WHERE rolname IN ('anon', 'authenticated')
                """
            )
            exposed_revision_roles = [
                role_name for role_name, has_privilege in cursor.fetchall() if has_privilege
            ]
            if exposed_revision_roles:
                print(
                    "FAIL: alembic_version is exposed to: "
                    + ", ".join(sorted(exposed_revision_roles)),
                    file=sys.stderr,
                )
                return 1

    print("RLS verification passed.")
    return 0


def _run_main() -> int:
    try:
        return main()
    except psycopg.Error as error:
        error_code = error.sqlstate or "unavailable"
        print(
            f"FAIL: database verification failed (SQLSTATE {error_code}).",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(_run_main())
