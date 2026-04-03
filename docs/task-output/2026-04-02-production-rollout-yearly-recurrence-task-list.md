# 2026-04-02 Production Rollout: Yearly Recurrence + Task List Index

## Outcome

- Captured fresh hosted backups before the schema rollout:
  - schema dump: `/tmp/gust-prod-pre-0013-20260402-230358.sql`
  - data dump: `/tmp/gust-prod-pre-0013-data-20260402-230404.sql`
- Applied the production schema changes for:
  - `0013_add_yearly_recurrence`
  - `0014_task_list_index`
- Redeployed the Railway `backend` and `frontend` services from merged `main` at `1771d56`.
- Updated the backend production floor to `REQUIRED_ALEMBIC_REVISION=0014_task_list_index`.

## Migration Notes

- The runtime pooler role could not own the affected tables, so the schema changes were applied through the linked Supabase admin query path.
- `alembic current` against production now reports `0014_task_list_index (head)`.

## Deployment Evidence

- Backend Railway deployment:
  - deployment id `c55a6c20-f249-42ec-829c-151993bdb156`
  - status `SUCCESS`
- Frontend Railway deployment:
  - deployment id `589a1c33-834f-4561-8ed6-d4eeefa6ae46`
  - status `SUCCESS`
- Live backend health endpoint and frontend homepage verification both passed in the production deploy helper.

## Notes

- The direct runtime-role RLS probe was temporarily blocked by the Supabase pooler circuit breaker after repeated authentication retries, so the release report relies on the successful Railway health checks plus the manual hosted migration verification above.
