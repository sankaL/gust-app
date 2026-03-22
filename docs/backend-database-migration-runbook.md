# Gust Backend and Database Migration Runbook

**Version:** 1.0  
**Last Updated:** 2026-03-22

This runbook governs schema bootstrap, migration rollout, rollback safety, and verification for Gust v1. It applies to local development, CI, and deployed environments.

## Principles

- Treat [database_schema.md](/Users/sankal/Documents/professional/gust-app/docs/database_schema.md) as the schema source of truth.
- Fail closed if the application migration level is behind the required revision.
- Prefer additive and reversible migrations.
- Do not rely on implicit Supabase RLS behavior for backend correctness.
- Never perform destructive same-step rollback assumptions without an explicit backup and recovery plan.

## Local Bootstrap Order

Local development uses a Makefile-managed Docker stack plus local Supabase CLI services.

Bootstrap sequence:

1. Ensure `GUST_DEV_MODE=true` in local env files.
2. Start local Supabase services through the Makefile entrypoint.
3. Start Dockerized backend and frontend services through the Makefile entrypoint.
4. Install backend dependencies and configure Alembic against the local database.
5. Run Alembic migrations to the latest revision before serving real application traffic.
6. Start the backend app only after migration verification succeeds.
7. Start the frontend app against the backend base URL for the local stack.

Guardrails:

- Local development must not connect to hosted production Supabase Auth or the production database.
- Dev mode changes infrastructure targets only. It must not bypass auth or validation behavior in application code.

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

## Rollout Order

For environments with existing deployments, use this order:

1. Confirm the target revision and review migration risk.
2. Take or verify the availability of a recoverable database backup.
3. Apply database migrations.
4. Verify migration success and required invariants.
5. Deploy backend services that depend on the new schema.
6. Verify backend health and startup migration-level checks.
7. Deploy frontend changes that depend on the backend behavior.
8. Verify the user-visible flow and background job behavior.

Why this order:

- the backend must not start against an unknown or older schema
- the frontend must not assume routes or contracts not yet available in the backend

## Post-Deploy Verification

Minimum verification after applying schema-affecting changes:

- Alembic reports the expected head revision.
- Backend startup revision check passes.
- `users.timezone` exists and accepts valid IANA timezone data.
- Each sampled user has exactly one Inbox group with `system_key = 'inbox'`.
- No task row has a null `group_id`.
- Group names are unique per user.
- Reminder uniqueness and idempotency constraints exist:
  - one reminder row per task occurrence
  - unique `idempotency_key`
- Reminder lifecycle fields exist for claiming and send tracking.
- Capture retention fields exist and new rows receive an `expires_at` value.

For reminder-related releases, also verify:

- pending reminders can be claimed transactionally
- claimed rows expire safely if a worker dies
- sent reminders store provider message IDs

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
- reminder or recurrence contract rewrites that can duplicate or orphan lifecycle rows

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

## Operational Ownership

- Schema contract owner: backend/application engineering
- Rollout execution owner: deployment operator for the target environment
- Final verification owner: engineer shipping the change

If ownership is unclear, stop and resolve responsibility before applying migrations in a shared environment.
