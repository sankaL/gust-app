# Task Output

## Task

Implement Phase 0: Contracts and Foundation.

## What Changed

- Populated `docs/database_schema.md` with the normalized v1 schema contract for users, groups, tasks, subtasks, captures, reminders, recurrence, timezone storage, and bounded retention.
- Populated `docs/backend-database-migration-runbook.md` with local bootstrap order, rollout sequence, rollback guidance, and post-deploy verification checks.
- Scaffolded the frontend foundation with React, TypeScript, Vite, React Router, TanStack Query, Tailwind, CSS tokens, PWA manifest/service-worker setup, placeholder Capture and Tasks routes, and baseline tests.
- Scaffolded the backend foundation with FastAPI, typed settings, a health endpoint, placeholder route modules, SQLAlchemy Core engine helpers, Alembic wiring, a baseline revision, and baseline tests.
- Added dev-mode local development support with a Makefile, Docker app containers, local Supabase configuration, env examples, and GitHub Actions CI for frontend and backend checks.

## Validation

- `make check`
- `cd backend && .venv/bin/alembic heads`

## Follow-Up Needed

- Phase 1 should replace the placeholder backend routers with real auth/session and data-access behavior.
- Phase 1 should add the first substantive Alembic migration implementing the documented schema.
- Future PWA work should replace the Phase 0 SVG placeholders with production app icons and install-flow polish.
