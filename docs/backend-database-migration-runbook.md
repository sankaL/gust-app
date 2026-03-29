# Gust Backend and Database Migration Runbook

**Version:** 1.7  
**Last Updated:** 2026-03-28

This runbook governs schema bootstrap, migration rollout, rollback safety, and verification for Gust v1. It applies to local development, CI, and deployed environments.

## Principles

- Treat [database_schema.md](/Users/sankal/Documents/professional/gust-app/docs/database_schema.md) as the schema source of truth.
- Fail closed if the application migration level is behind the required revision.
- Prefer additive and reversible migrations.
- Do not rely on implicit Supabase RLS behavior for backend correctness.
- Keep the backend runtime role free of `BYPASSRLS` if table policies are expected to protect direct Postgres access.
- Never perform destructive same-step rollback assumptions without an explicit backup and recovery plan.

## Local Bootstrap Order

Local development uses a Makefile-managed Docker stack plus local Supabase CLI services.

Bootstrap sequence:

1. Ensure `GUST_DEV_MODE=true` in local env files.
2. Start the local stack through the Makefile entrypoint (`make dev`, `make local`, or `make dev local`).
3. If the default local ports are already occupied, assign alternate free host ports for the frontend, backend, and local Supabase services before startup.
4. Reuse the existing local Supabase database state; do not reset or rebuild the database for routine restarts.
5. Check the current Alembic revision against the repo head and run `alembic upgrade head` only when the local database is behind.
6. Start the backend app only after migration verification succeeds.
7. Start the frontend app against the backend base URL for the local stack.

Guardrails:

- Local development must not connect to hosted production Supabase Auth or the production database.
- Dev mode changes infrastructure targets only. It must not bypass auth or validation behavior in application code.
- Local auth testing in dev mode should use Google OAuth through the local Supabase provider config; the backend-mediated local test-account flow is an optional fallback and must still issue the same backend cookie session.
- The local backend must target the current required application revision and local Supabase Auth endpoints before it serves traffic.
- The local runtime env must carry the active local Supabase anon key before the backend starts, or local sign-in flows will fail.
- When local Google OAuth is enabled, the local runtime env must also carry valid Google client credentials before `supabase start`.
- The startup entrypoint must print the chosen local URLs when it falls back to non-default ports.

## Environment Contract

Expected environment classes:

- local dev mode
- CI test mode
- deployed non-production
- deployed production

Migration-sensitive configuration must include:

- application database URL
- Alembic migration path
- required migration revision or startup revision check enablement
- app environment indicator
- dev-mode flag

Secrets must never be hardcoded in migration files, Dockerfiles, or CI workflows.

## Migration Authoring Rules

- Use Alembic for all application schema changes.
- Prefer one logical change set per migration revision.
- Name constraints and indexes explicitly.
- Make ownership and uniqueness invariants machine-checkable wherever feasible.
- Avoid data backfills inside the same revision if they risk long locks; split schema and backfill work when needed.
- New non-null columns on populated tables should be added with a safe staged approach:
  - add nullable column
  - backfill deterministically
  - enforce non-null in a later step
- When changing reminder, recurrence, timezone, or Inbox behavior, update this runbook in the same task.

## Phase 0 Baseline

Phase 0 establishes:

- Alembic environment and startup revision checks
- a baseline revision only if needed for version verification
- documented rollout order and verification steps

Phase 0 does not yet require the full production application schema migration set. The first substantive schema revision lands in Phase 1 and must align with [database_schema.md](/Users/sankal/Documents/professional/gust-app/docs/database_schema.md).

## Phase 1 Revision

Phase 1 introduces `0002_phase1_core_backend` as the required application revision.

That revision establishes:

- the substantive v1 application tables for users, groups, tasks, subtasks, captures, and reminders
- Inbox uniqueness and non-null task group ownership invariants
- named task/capture/reminder/recurrence value constraints
- the persisted `users.timezone` contract used by auth bootstrap and reminder/date resolution

Deployment implication:

- environments must apply `0002_phase1_core_backend` before running the Phase 1 backend, because startup revision checks now require that revision by default

## Phase 2 Revision

Phase 2 introduces `0003_phase2_capture_extraction` as the required application revision.

That revision establishes:

- the canonical `tasks.reminder_at` field used by capture extraction and later task-edit/reminder flows
- compatibility between capture-created task reminders and the dedicated `reminders` table
- the migration floor required by the synchronous capture/transcription/extraction backend

Deployment implication:

- environments must apply `0003_phase2_capture_extraction` before running the Phase 2 backend, because startup revision checks now require that revision by default

## Phase 4 Revision

Phase 4 introduces `0004_phase4_reminders_retention` as the required application revision.

That revision establishes:

- `tasks.capture_id` cleanup compatibility by changing the capture foreign key to `ON DELETE SET NULL`
- the migration floor required by the internal reminder worker and bounded capture-retention cleanup

Deployment implication:

- environments must apply `0004_phase4_reminders_retention` before running the Phase 4 backend, because startup revision checks now require that revision by default

## Phase 8 Revision (Digest Cutover)

Phase 8 introduces `0008_digest_dispatches` as the required application revision.

That revision establishes:

- `digest_dispatches` table for per-user/per-period digest idempotency and outcomes
- one-time cancellation of legacy `reminders` rows in `pending`/`claimed` states
- the migration floor required by split daily/weekly Railway digest cron services

Deployment implication:

- environments must apply `0008_digest_dispatches` before running digest-mode backend jobs, because startup revision checks now require that revision by default

## Phase 9 Revision (Task Descriptions)

Phase 9 introduces `0009_task_descriptions` as the required application revision.

That revision establishes:

- nullable `tasks.description` for first-class saved-task context
- nullable `extracted_tasks.description` so staged extraction output can preserve short context before approval

Deployment implication:

- environments must apply `0009_task_descriptions` before running the backend that reads or writes task descriptions, because startup revision checks now require that revision by default

## Phase 10 Revision (Postgres RLS Enforcement)

Phase 10 introduces `0010_enable_postgres_rls` as the required application revision.

That revision establishes:

- Postgres row-level security enabled and forced on all user-owned application tables
- one actor policy per protected table keyed off `app.current_user_id` or `app.internal_job`
- the migration floor required by backend transactions that now set explicit Postgres actor context

Deployment implication:

- environments must apply `0010_enable_postgres_rls` before running the backend that sets transaction-scoped DB actor context
- the normal backend runtime role must not have `BYPASSRLS`, or the policies will not provide protection

## Phase 11 Revision (Security Hardening Counters)

Phase 11 introduces `0011_rate_limit_counters` as the required application revision.

That revision establishes:

- `rate_limit_counters` for shared fixed-window abuse counters keyed by scope, subject, and window
- the migration floor required by backend request rate limiting on auth, capture, and general API routes
- bounded cleanup support through `rate_limit_counters.expires_at`

Deployment implication:

- environments must apply `0011_rate_limit_counters` before running the backend that enforces request throttling, because startup revision checks now require that revision by default

## Rollout Order

For environments with existing deployments, use this order:

1. Confirm the target revision and review migration risk.
2. Confirm the production runtime role does not have `BYPASSRLS`.
3. Take or verify the availability of a recoverable database backup.
4. Apply database migrations.
5. Verify migration success and required invariants.
6. Deploy backend services that depend on the new schema and new request-security settings.
7. Verify backend health, startup migration-level checks, and edge-facing request protections.
8. Deploy frontend changes that depend on the backend behavior.
9. Verify the user-visible flow and background job behavior.

Why this order:

- the backend must not start against an unknown or older schema
- the frontend must not assume routes or contracts not yet available in the backend

## Production Service Mapping

Current production deployment contract:

- frontend Railway service deploys from `frontend/` using `frontend/railway.json`
- backend Railway service deploys from `backend/` using `backend/railway.json`
- daily digest Railway cron deploys from `deploy/digest-daily-cron/`
- weekly digest Railway cron deploys from `deploy/digest-weekly-cron/`
- public domains are:
  - `https://gustapp.ca`
  - `https://api.gustapp.ca`
  - `https://auth.gustapp.ca`

Production database ownership rules:

- hosted Supabase project provisioning and config are managed through the Supabase CLI
- application schema changes are applied through Alembic only
- Supabase Auth hook assets such as `public.allowed_users` and `public.before_user_created_allowlist(jsonb)` are versioned under `supabase/` and applied through the Supabase project workflow, not Alembic
- the backend runtime role must retain `SELECT` on `public.allowed_users`, because callback and session-refresh auth checks read that table directly
- do not use `supabase db push` for the application schema
- backend deploys are expected to run `alembic upgrade head` before startup and then pass the startup revision check
- run `python scripts/prod/check-postgres-rls.py --database-url "$DATABASE_URL"` against the production runtime connection string before and after rollout
- if the runtime role reports `rolbypassrls=true`, switch the app to a non-bypass runtime role and reserve the privileged/admin connection for migrations only
- once the runtime role is a least-privilege non-bypass role, do not rely on that runtime `DATABASE_URL` for future DDL-bearing migrations; run hosted Alembic with a privileged migration/admin connection before the backend deploy or provide a separate migration-only connection path
- backend deploy config must carry the trusted-host list, allowed frontend/backend origins, and any explicit rate-limit overrides expected for the environment

Allowlist administration:

- add an email with `insert into public.allowed_users (email) values ('new@example.com');`
- remove an email with `delete from public.allowed_users where email = 'old@example.com';`
- the allowlist trigger normalizes `email` to lowercase trimmed text before storage

## Post-Deploy Verification

Minimum verification after applying schema-affecting changes:

- Alembic reports the expected head revision.
- The required revision configured for the backend matches `0011_rate_limit_counters` or the current deployed head.
- Backend startup revision check passes.
- `scripts/prod/check-postgres-rls.py` passes against the runtime `DATABASE_URL`.
- The current Postgres runtime role reports `rolbypassrls = false`.
- `users`, `groups`, `captures`, `tasks`, `subtasks`, `reminders`, `extracted_tasks`, and `digest_dispatches` all report both `row_security = true` and `force_row_security = true`.
- `users.timezone` exists and accepts valid IANA timezone data.
- Each sampled user has exactly one Inbox group with `system_key = 'inbox'`.
- No task row has a null `group_id`.
- `tasks.reminder_at` exists and remains nullable for legacy rows without reminders.
- `tasks.description` exists and remains nullable for legacy rows.
- `extracted_tasks.description` exists and remains nullable for legacy rows.
- Group names are unique per user.
- Digest dispatch uniqueness and idempotency constraints exist:
  - one `digest_dispatches` row per `user + digest_type + period`
  - unique `digest_dispatches.idempotency_key`
- Legacy reminder rows in `pending` or `claimed` were cancelled during migration.
- Capture retention fields exist and new rows receive an `expires_at` value.
- `tasks.capture_id` supports capture cleanup without orphaning tasks.
- `public.allowed_users` exists and contains the intended private-access email set.
- the backend runtime role can `SELECT` from `public.allowed_users`.
- the Supabase `before_user_created` hook is enabled and points to `public.before_user_created_allowlist`.
- an allowlisted Google email can complete signup/sign-in.
- a non-allowlisted Google email is rejected before `auth.users` insertion.
- a previously-created but now-removed email cannot restore a backend session and is redirected or returned as `auth_email_not_allowed`.
- `rate_limit_counters` exists with the composite primary key and `expires_at` cleanup index.
- `POST /auth/session/google/start` returns both the PKCE verifier cookie and the backend OAuth state cookie.
- `GET /auth/session/callback` rejects missing or invalid backend OAuth `state`.
- Unsafe cookie-authenticated methods reject requests with missing or foreign `Origin` / `Referer`.
- Trusted host enforcement accepts the deployed frontend/backend hosts and rejects unexpected `Host` headers.
- Auth/session and authenticated JSON responses emit `Cache-Control: no-store` plus the committed security headers.

For capture/extraction releases, also verify:

- `POST /captures/text`, `POST /captures/voice`, and `POST /captures/{capture_id}/submit` succeed against the deployed schema
- failed transcription or extraction attempts leave capture rows in explicit failure states without creating partial task writes
- repeated capture/auth requests eventually return `429 rate_limit_exceeded` with `Retry-After` and `X-RateLimit-*` headers
- lock contention on duplicate in-flight capture work returns `429 rate_limit_exceeded` instead of running concurrent expensive provider calls
- oversized text captures, control-character payloads, oversize audio uploads, and disallowed audio MIME types are rejected cleanly

For digest-related releases, also verify:

- the internal digest route rejects missing or invalid shared-secret auth
- `POST /internal/reminders/run?mode=daily` succeeds with shared-secret auth
- `POST /internal/reminders/run?mode=weekly` succeeds with shared-secret auth
- digest summary response returns mode-specific counters (`users_processed`, `sent`, `skipped_empty`, `failed`, `captures_deleted`)
- digest dispatch rows store provider message IDs for `sent` rows and `skipped_empty` status for empty periods
- expired captures are deleted in bounded batches and task rows survive with `capture_id = null`

For RLS-related releases, also verify:

- authenticated session routes still bootstrap and refresh the local user row and Inbox group
- authenticated task/group/capture/staging routes still succeed for the signed-in user
- digest/cleanup jobs still succeed through the internal-job context path
- a direct runtime-role query without actor context does not return user-owned rows from protected tables

## Railway Cron DST Maintenance

Digest schedules are interpreted in Eastern time but Railway cron expressions are UTC-based.

Required active schedules:

- Standard time (EST):
  - daily digest run: `13:30 UTC` (8:30 AM EST)
  - weekly digest run: Sunday `14:00 UTC` (9:00 AM EST)
- Daylight time (EDT):
  - daily digest run: `12:30 UTC` (8:30 AM EDT)
  - weekly digest run: Sunday `13:00 UTC` (9:00 AM EDT)

Runbook procedure at DST boundary:

1. Confirm Eastern offset transition date for the current year.
2. Update both Railway cron service schedules (`digest-daily-cron`, `digest-weekly-cron`) to the matching UTC times above.
3. Trigger a manual dry run against `POST /internal/reminders/run?mode=daily` and `mode=weekly` with shared-secret auth.
4. Confirm job logs show expected mode and non-error completion.
5. Confirm one test user generates either `sent` or `skipped_empty` in `digest_dispatches` for the expected Eastern period.

## Rollback Guidance

Default rollback stance:

- roll forward when possible
- do not assume down migrations are safe for destructive changes on populated data

Safe rollback categories:

- additive indexes
- additive nullable columns not yet consumed
- non-destructive metadata corrections

High-risk rollback categories requiring explicit recovery planning:

- dropped columns or tables
- type narrowing
- uniqueness enforcement on dirty historical data
- digest or recurrence contract rewrites that can duplicate or orphan lifecycle rows

When rollback is necessary:

1. Stop or pause background workers that may mutate affected tables.
2. Assess whether application traffic must be paused.
3. Restore from backup or apply a tested down migration only if proven safe.
4. Re-run post-deploy verification checks before reopening traffic.

## Data Backfills and Compatibility

- Backfills must be idempotent and restart-safe.
- Backfills should operate in bounded batches.
- If a release depends on both schema changes and code changes, preserve compatibility for the rollout window:
  - schema first
  - code second
- Avoid requiring the frontend to coordinate with partially migrated database states.

## CI and Pre-Deploy Checks

Before merge or deploy:

- backend tests pass
- migration files load without import errors
- Alembic can resolve `head`
- startup revision check tests pass
- documentation updates are present for any schema or rollout contract change

## Railway Deploy Automation Fallback

If Railway-native repo auto-deploy is not linked for the production services, use the repo-owned fallback automation:

- manual operator path: `scripts/prod/deploy-railway-prod.sh`
- GitHub Actions path: `.github/workflows/railway-prod-deploy.yml`

Fallback contract:

- the workflow runs only after the `CI` workflow completes successfully on `main`
- the GitHub Actions deploy workflow should use repository secret `RAILWAY_TOKEN` with a Railway project token scoped to the production environment; `RAILWAY_API_TOKEN` remains a legacy fallback for account/workspace-token setups
- the deploy script uploads the four production services from their checked-in source directories:
  - `backend/`
  - `frontend/`
  - `deploy/digest-daily-cron/`
  - `deploy/digest-weekly-cron/`
- the frontend Railway deploy must bypass gitignore filtering during CLI upload so tracked `frontend/src/lib/*.ts` files are not omitted from the build context
- the script polls Railway deployment status for each service and verifies the live frontend and backend URLs after rollout

## Operational Ownership

- Schema contract owner: backend/application engineering
- Rollout execution owner: deployment operator for the target environment
- Final verification owner: engineer shipping the change

If ownership is unclear, stop and resolve responsibility before applying migrations in a shared environment.
