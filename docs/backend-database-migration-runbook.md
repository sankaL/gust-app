# Gust Backend and Database Migration Runbook

**Version:** 1.11
**Last Updated:** 2026-08-12

This runbook governs schema bootstrap, migration rollout, rollback safety, and verification for Gust v1. It applies to local development, CI, and deployed environments.

## Principles

- Treat [database_schema.md](/Users/sankal/Documents/professional/gust-app/docs/database_schema.md) as the schema source of truth.
- Fail closed if the application migration level is behind the required revision.
- Prefer additive and reversible migrations.
- Do not rely on implicit Supabase RLS behavior for backend correctness.
- Keep the backend runtime role free of `BYPASSRLS` if table policies are expected to protect direct Postgres access.
- Never perform destructive same-step rollback assumptions without an explicit backup and recovery plan.

## Local Bootstrap Order

Local development uses a Makefile-managed Docker stack containing only PostgreSQL, the
backend, and the frontend. The Supabase CLI is not part of the routine local stack.

Bootstrap sequence:

1. Ensure `GUST_DEV_MODE=true` in local env files.
2. Start the local stack through the Makefile entrypoint (`make dev`, `make local`, or `make dev local`).
3. If a default port is occupied, let the runtime generator choose an alternate free host port for that service before startup.
4. Reuse the named local PostgreSQL volume; do not reset or rebuild it for routine restarts.
5. Check the current Alembic revision against the repo head and run `alembic upgrade head` only when the local database is behind.
6. Start the backend app only after migration verification succeeds.
7. Start the frontend app against the backend base URL for the local stack.

Guardrails:

- Local development must not connect to hosted production Supabase Auth or the production database.
- Dev mode uses a backend-issued local test-account session; it does not disable authentication, allowlisting, CSRF, origin validation, or explicit user scoping.
- `LOCAL_DEV_AUTH_SECRET` must contain at least 32 characters. Missing or short values fail closed.
- The dev-only issuer and `/auth/session/dev-login` endpoint must remain unavailable unless `GUST_DEV_MODE=true`.
- Google OAuth and its callback are intentionally unavailable in local dev mode. Test the production Supabase OAuth lifecycle in a dedicated non-local integration environment.
- The local backend must target the current required Alembic revision before it serves traffic.
- Backend startup seeds the local test identity and Inbox. `make dev` then seeds the deterministic dashboard fixture only when the local test account has no tasks; existing local data is preserved on later starts. The explicit dashboard seed target remains available when a reset of the fixture is desired.
- The startup entrypoint must print the chosen local URLs when it falls back to non-default ports.

## Environment Contract

Expected environment classes:

- local dev mode
- CI test mode
- deployed non-production
- deployed production

Migration-sensitive configuration must include:

- application database URL
- migration/admin database URL for DDL-bearing deployed migrations once the runtime role is least-privilege
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

## Revision 0019 (Notification Preferences and Pushover Reminders)

Deploy `0019_pushover_reminders` before enabling Pushover delivery. It creates default notification-preference rows for every user, adds `reminder_date`, retry scheduling, and digest channel idempotency without converting legacy exact-time values. Configure provider and Fernet secrets on the backend first, keep `PUSHOVER_NOTIFICATIONS_ENABLED=false` through callback/test validation, then deploy the five-minute task cron. Disable the feature flag and task cron to roll back delivery safely; email digests remain independent.

Before enabling the feature flag or task cron, verify the migration completed with these read-only checks; each must return zero rows (or count `0`):

```sql
SELECT count(*) FROM users u
LEFT JOIN notification_preferences p ON p.user_id = u.id
WHERE p.user_id IS NULL;

SELECT count(*) FROM reminders WHERE next_attempt_at IS NULL;

SELECT user_id, digest_type, period_start_date, period_end_date, channel, count(*)
FROM digest_dispatches
GROUP BY user_id, digest_type, period_start_date, period_end_date, channel
HAVING count(*) > 1;
```

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

## Phase 12 Revision (Backend-Only Table Grants)

Phase 12 introduces `0012_harden_backend_table_grants` as the required application revision.

That revision establishes:

- `public.rate_limit_counters` revoked from hosted `anon` and `authenticated` roles
- explicit read/write grants on `public.rate_limit_counters` only for the backend runtime role
- the migration floor required to keep backend-only operational tables out of end-user Supabase API reach

Deployment implication:

- environments must apply `0012_harden_backend_table_grants` before running the backend, because startup revision checks now require that revision by default
- hosted Supabase environments must also apply the paired `supabase/` grant-hardening migration for `public.allowed_users`

## Phase 13 Revision (Yearly Recurrence)

Phase 13 introduces `0013_add_yearly_recurrence` as the required application revision.

That revision establishes:

- `tasks.recurrence_month` and `extracted_tasks.recurrence_month`
- yearly recurrence support in task normalization, extraction, editing, and completion flows
- the migration floor required by backend/frontend code that reads or writes yearly recurrence values

Deployment implication:

- environments must apply `0013_add_yearly_recurrence` before running the backend or frontend that understands yearly recurrence

## Phase 14 Revision (Task List Pagination Index)

Phase 14 introduces `0014_task_list_index` as the required application revision.

That revision establishes:

- the composite partial task-list pagination index on `tasks(user_id, status, created_at DESC, id DESC) WHERE deleted_at IS NULL`
- the migration floor required by the optimized task-list query path

Deployment implication:

- environments must apply `0014_task_list_index` before relying on the optimized task-list pagination path in production

## Phase 15 Revision (Completed Task Analytics Index)

Phase 15 introduces `0015_completed_tasks_index` as the required application revision.

That revision establishes:

- the composite partial completed-task analytics index on `tasks(user_id, status, completed_at DESC, id DESC) WHERE deleted_at IS NULL AND completed_at IS NOT NULL`
- the migration floor required by date-bounded completed-task list queries used by desktop dashboard analytics

Deployment implication:

- environments must apply `0015_completed_tasks_index` before relying on the optimized completed-task analytics range path in production

## Phase 16 Revision (Relational RLS Hardening)

Phase 16 introduces `0016_harden_rls_relationships` as the required application revision.

That revision establishes:

- enabled and forced RLS on every user-owned application table
- actor policies that verify both the row's `user_id` and ownership of referenced parent rows for tasks, subtasks, reminders, and staged extracted tasks
- bounded rate-limit counter keys and nonnegative counts
- positive fixed-window durations while preserving the intentional zero-duration sentinel used only by `action_lock:*` rows

Deployment implication:

- apply `0016_harden_rls_relationships` with the privileged migration connection before deploying the backend that requires revision 0016
- the migration sets a five-second lock timeout, takes a fixed-order write-blocking lock across relationship tables to make the preflight race-free, and replaces policies under short table locks; deploy during a low-traffic window and keep a recoverable backup available
- the migration performs no data rewrite or backfill, and fails closed if it finds a historical cross-owner parent relationship
- counter checks are added `NOT VALID` and then validated under PostgreSQL's weaker validation lock; the migration still fails closed if existing counter rows violate them
- run the documented relationship and counter preflight queries before deployment so a validation failure is discovered before the maintenance window
- after deployment, run the RLS verification script with the least-privilege runtime connection and exercise authenticated capture/task flows plus both internal digest modes

Phase 17 introduces `0017_harden_alembic_metadata` as the required application revision.

- remove Supabase-created end-user grants and policies from `public.alembic_version`
- retain `SELECT` only for `gust_app_runtime`, protected by a role-specific RLS policy, so the startup revision guard can see exactly one row
- reserve all revision writes for the privileged migration role
- run the production RLS verifier after migration; it now fails if the runtime role cannot see one revision row or if `anon` / `authenticated` retain access

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
- hosted `anon` and `authenticated` roles must not retain table privileges on `public.allowed_users` or `public.rate_limit_counters`
- hosted `anon`, `authenticated`, and `service_role` roles must not retain table privileges on `public.alembic_version`
- the backend runtime role must retain only `SELECT` on `public.allowed_users`, because callback and session-refresh auth checks read that table directly
- the backend runtime role may retain only `SELECT`, `INSERT`, `UPDATE`, and `DELETE` on `public.rate_limit_counters`
- the backend runtime role must retain only `SELECT` on `public.alembic_version` for startup revision verification
- do not use `supabase db push` for the application schema
- backend deploys are expected to run `alembic upgrade head` before startup and then pass the startup revision check
- backend predeploy/start commands must invoke `/app/.venv/bin/alembic` and `/app/.venv/bin/uvicorn` explicitly (or otherwise preserve the image virtual-environment path); do not use a login shell that resets the Docker image `PATH`
- the Railway CLI fallback must upload the repository root for backend/frontend because those services already configure `/backend` and `/frontend` root directories; only standalone digest build directories use `--path-as-root`
- Railway production deploys must provide `MIGRATION_DATABASE_URL` as a privileged migration/admin connection, while `DATABASE_URL` remains the least-privilege runtime connection used by the app after startup
- run `python scripts/prod/check-postgres-rls.py --database-url "$DATABASE_URL"` against the production runtime connection string before and after rollout
- if the runtime role reports `rolbypassrls=true`, switch the app to a non-bypass runtime role and reserve the privileged/admin connection for migrations only
- once the runtime role is a least-privilege non-bypass role, do not rely on that runtime `DATABASE_URL` for future DDL-bearing migrations; use `MIGRATION_DATABASE_URL` or another privileged migration-only connection path for Alembic
- backend deploy config must carry the trusted-host list, allowed frontend/backend origins, and any explicit rate-limit overrides expected for the environment
- Railway deployments with trusted-host enforcement must allow the exact probe hostname `healthcheck.railway.app`; public traffic remains restricted to configured Gust/Railway domains

Allowlist administration:

- add an email with `insert into public.allowed_users (email) values ('new@example.com');`
- remove an email with `delete from public.allowed_users where email = 'old@example.com';`
- the allowlist trigger normalizes `email` to lowercase trimmed text before storage

## Post-Deploy Verification

Minimum verification after applying schema-affecting changes:

- Alembic reports the expected head revision.
- Production Railway backend deploys fail closed if `APP_ENV=production` and `MIGRATION_DATABASE_URL` is missing.
- The required revision configured for the backend matches `0017_harden_alembic_metadata` or the current deployed head.
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
- the backend runtime role can `SELECT` from `public.allowed_users` and hosted `anon` / `authenticated` roles cannot.
- the Supabase `before_user_created` hook is enabled and points to `public.before_user_created_allowlist`.
- an allowlisted Google email can complete signup/sign-in.
- a non-allowlisted Google email is rejected before `auth.users` insertion.
- a previously-created but now-removed email cannot restore a backend session and is redirected or returned as `auth_email_not_allowed`.
- `rate_limit_counters` exists with the composite primary key and `expires_at` cleanup index.
- `rate_limit_counters` rejects empty/oversized keys, negative counts, and nonpositive windows except for the explicit `action_lock:*` zero-duration sentinel.
- hosted `anon` / `authenticated` roles cannot read or mutate `public.rate_limit_counters`.
- `POST /auth/session/google/start` returns a short-lived, high-entropy PKCE verifier cookie and does not attach a backend-owned OAuth `state` parameter that Supabase social sign-in would consume rather than echo to Gust.
- `GET /auth/session/callback` rejects a missing PKCE verifier cookie.
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
- direct inserts/updates cannot attach a current user's task, subtask, reminder, or staged extracted task to another user's parent row

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
