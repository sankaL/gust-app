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


def main() -> int:
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

    with psycopg.connect(args.database_url) as connection:
        with connection.cursor() as cursor:
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
                SELECT tablename, policyname
                  FROM pg_policies
                 WHERE schemaname = 'public'
                   AND tablename = ANY(%s)
                """,
                (list(TABLE_NAMES),),
            )
            policies_by_table: dict[str, set[str]] = {}
            for table_name, policy_name in cursor.fetchall():
                policies_by_table.setdefault(table_name, set()).add(policy_name)

            missing_policies = [
                table_name
                for table_name in TABLE_NAMES
                if f"{table_name}_actor_rls" not in policies_by_table.get(table_name, set())
            ]
            if missing_policies:
                print(
                    "FAIL: missing actor RLS policies on: " + ", ".join(sorted(missing_policies)),
                    file=sys.stderr,
                )
                return 1

    print("RLS verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
