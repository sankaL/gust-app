# Task Output: Postgres RLS Enforcement

## Date
- 2026-03-28

## Summary
- Added a new Alembic revision, `0010_enable_postgres_rls`, that enables and forces Postgres row-level security on all user-owned application tables and creates actor-based policies for authenticated users and internal jobs.
- Updated backend DB transaction handling so authenticated request paths set `app.current_user_id` and digest/cleanup jobs set `app.internal_job = true` for each Postgres transaction.
- Added a production verification script, `scripts/prod/check-postgres-rls.py`, to validate both table-level RLS state and whether the runtime role has `BYPASSRLS`.

## Implemented Behavior
- Protected tables:
  - `users`
  - `groups`
  - `captures`
  - `tasks`
  - `subtasks`
  - `reminders`
  - `extracted_tasks`
  - `digest_dispatches`
- API/auth behavior:
  - authenticated session bootstrap, timezone updates, task/group/capture flows, and staging flows now open user-scoped DB transactions
  - SQLite test/dev behavior remains unchanged because actor settings are only applied on Postgres
- Background job behavior:
  - digest and cleanup work now opens internal-job-scoped DB transactions so legitimate cross-user operations still succeed under RLS

## Validation Scope
- Added migration coverage for the new Phase 10 Alembic revision and its Postgres-only/no-op-on-SQLite behavior.
- Added a Postgres verification path through `scripts/prod/check-postgres-rls.py` for live/local Postgres environments.
- Existing SQLite-backed API/service tests remain expected to validate application-layer user scoping separately from Postgres policy enforcement.

## Notes
- RLS is intentionally defense in depth. Backend repositories still keep explicit `user_id` filters and do not rely on implicit request-context behavior inside Supabase.
- Production rollout still requires checking the actual runtime DB role behind `DATABASE_URL`; if it has `BYPASSRLS`, the policies will not protect direct backend access until the runtime role is changed.
