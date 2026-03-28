# 2026-03-28 Production Postgres RLS Rollout

## Scope

- Applied the hosted Alembic upgrade through `0010_enable_postgres_rls`.
- Switched the Railway backend runtime off the Supabase `postgres` role onto a dedicated non-`BYPASSRLS` role.
- Redeployed the production backend from merged `main` so the live app uses the new runtime connection and actor-scoped RLS context.

## What Changed In Production

- Took a recoverable hosted backup before migration:
  - `/tmp/gust-prod-20260328-075153-pre-rls.sql`
- Updated the backend production floor:
  - `REQUIRED_ALEMBIC_REVISION=0010_enable_postgres_rls`
- Ran hosted Alembic against the Supabase pooler and confirmed:
  - `0010_enable_postgres_rls (head)`
- Created and granted a dedicated runtime role for application traffic:
  - login role: `gust_app_runtime`
  - production pooler username format: `gust_app_runtime.<project-ref>`
- Updated Railway backend `DATABASE_URL` to the non-bypass runtime role.
- Redeployed the Railway `backend` service from:
  - `main@1af73c0`

## Verification

- Hosted Alembic check passed at head:
  - `0010_enable_postgres_rls (head)`
- Live backend deployment succeeded on Railway:
  - deployment id `9467fd28-045d-4d54-82dd-e4b6200b7fb4`
  - CLI message `deploy main@1af73c0 backend`
- Live backend health check passed:
  - `https://api.gustapp.ca/health`
- Live production backend container now runs under the dedicated runtime role:
  - `current_user=gust_app_runtime`
  - `rolbypassrls=false`

## Notes

- The initial production runtime used the Supabase `postgres` role, which bypassed table policies and would have made the new RLS migration ineffective at runtime.
- Supabase pooler login for the custom runtime role required the username form `gust_app_runtime.<project-ref>`. Using `gust_app_runtime` without the project ref failed with `Tenant or user not found`.
- Only the backend service required redeploy for this rollout because the merged RLS change set touched backend/database code and docs, not frontend assets or the cron service images.
