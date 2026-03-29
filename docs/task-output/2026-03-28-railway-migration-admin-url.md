# Task Output: Railway Migration Admin URL Split

## Date
- 2026-03-28

## Summary
- Added backend support for a dedicated `MIGRATION_DATABASE_URL` so Alembic can run with a privileged/admin Postgres role while the live app continues to use a least-privilege runtime `DATABASE_URL`.
- Updated the Railway backend deploy contract to fail closed in production if `MIGRATION_DATABASE_URL` is missing.
- Brought the repo env templates and migration runbook into line with the current `0011_rate_limit_counters` revision floor and the split runtime-vs-migration connection model.

## Implemented Behavior
- Alembic now resolves its connection URL from `MIGRATION_DATABASE_URL` first and falls back to `DATABASE_URL` only when no separate migration URL is configured.
- Railway production predeploy exits before migration start when `APP_ENV=production` and `MIGRATION_DATABASE_URL` is unset.
- Runtime startup checks still validate the least-privilege `DATABASE_URL` against the required Alembic revision, so application traffic continues to use the hardened non-`BYPASSRLS` role.

## Validation Scope
- Added backend settings tests covering both the fallback and override behavior for the Alembic connection URL.
- Updated the production migration runbook to require a privileged migration connection for deployed DDL once the runtime role is least-privilege.

## Notes
- This change addresses the hosted failure mode where `0011_rate_limit_counters` tried to `CREATE TABLE` through the non-DDL Railway runtime role and hit `permission denied for schema public`.
