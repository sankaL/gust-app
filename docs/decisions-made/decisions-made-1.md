# Decisions Made

## 2026-03-22 11:45:55 EDT

- Standardized local testing guidance around an explicit env-file dev-mode flag and a Makefile-managed Docker stack instead of ad-hoc use of hosted production services.
- Explicitly prohibited local testing from connecting to production Supabase Auth or the production Supabase database.
- Relaxed bookkeeping rules so `docs/build-plan.md` remains mandatory after every task, while `docs/decisions-made/` and `docs/task-output/` are updated only for major decisions or major tasks.
- Standardized decision-log file naming on `decisions-made-<n>.md` and required rollover to the next numbered file once the current one grows beyond roughly 1000 lines.

## 2026-03-22 11:36:38 EDT

- Rewrote the root, `frontend/`, and `backend/` `AGENTS.md` files to describe Gust instead of DeepPatient.
- Standardized instruction-file references on the current Gust source documents: `PRD-Gust.md`, `Tech-Stack-Gust.md`, `Design.md`, `database_schema.md`, `backend-database-migration-runbook.md`, `build-plan.md`, `decisions-made/`, and `task-output/`.
- Kept the instruction files prescriptive at the contract/behavior level and explicitly avoided inventing code paths for frontend/backend modules that do not exist yet.
- Preserved strict task bookkeeping in the root instructions so documentation changes still require build-plan, decision-log, and task-output updates.
- Removed stale references to RBAC-focused behavior, evaluation contracts, JWT duration policy, and nonexistent schema/auth/ERD files carried over from the previous app.

## 2026-03-22 11:24:35 EDT

- Rewrote `docs/PRD-Gust.md` and `docs/Tech-Stack-Gust.md` as implementation-grade specs instead of aspirational notes.
- Standardized Inbox as a required per-user system group and rejected `NULL` as the product representation for “unassigned.”
- Standardized auth on secure cookie sessions and explicitly rejected browser localStorage token storage.
- Standardized backend data access on explicit user-scoped queries and rejected reliance on implicit Supabase RLS behavior for correctness.
- Narrowed recurrence for v1 to daily, weekly, and monthly presets and moved custom intervals/exceptions out of scope.
- Required reminder idempotency and best-effort reminder timing instead of minute-exact guarantees.
- Removed LangChain from the initial stack in favor of thin provider adapters with structured-output validation.
