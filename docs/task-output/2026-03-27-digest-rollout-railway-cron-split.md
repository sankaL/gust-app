# Task Output

## Task

Implement digest-only reminder delivery with Railway daily/weekly cron split and backend-owned business logic.

## What Changed

- Reworked the internal reminder worker to explicit digest execution modes: `daily` and `weekly`.
- Added `digest_dispatches` persistence with deterministic idempotency per `user + digest_type + period`, provider result tracking, and statuses `sent`, `failed`, and `skipped_empty`.
- Added Alembic revision `0008_digest_dispatches` to create digest dispatch storage and one-time cancel legacy `reminders` rows in `pending`/`claimed`.
- Disabled per-item reminder row creation across task, capture, and staging flows while preserving task reminder metadata fields.
- Kept bounded capture retention cleanup in the same internal job execution path.
- Kept scheduling split as Railway cron configuration only (`digest-daily-cron`, `digest-weekly-cron`) without adding a separate cron microservice codebase.

## Tests

- Added/updated backend tests for:
  - digest period boundaries in Eastern timezone for daily and weekly modes
  - weekly Monday-Sunday inclusion behavior
  - digest section membership (due today, overdue, completed this week, due this week and uncompleted)
  - digest idempotency and failed-then-retry behavior
  - empty digest skip tracking (`skipped_empty`)
  - internal digest route mode handling and shared-secret auth
  - migration contract for `0008_digest_dispatches`
  - regression behavior showing per-item reminder rows are no longer created/sent
- Ran full backend test suite in Python 3.12 container: `147 passed`.

## Documentation

- Updated `docs/PRD-Gust.md` from per-task reminder emails to digest-only delivery contract.
- Updated `docs/Tech-Stack-Gust.md` scheduler/email architecture to cron split + backend-owned digest logic.
- Updated `docs/database_schema.md` with `digest_dispatches` contract and revised legacy `reminders` semantics.
- Updated `docs/backend-database-migration-runbook.md` for revision `0008_digest_dispatches` and DST cron maintenance procedure.
- Updated `docs/build-plan.md` and `docs/decisions-made/decisions-made-1.md` for task and architectural decisions.
