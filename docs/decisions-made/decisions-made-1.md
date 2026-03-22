# Decisions Made

## 2026-03-22 19:05:00 EDT

- Added `tasks.reminder_at` in Phase 2 and treated it as the canonical task-level reminder timestamp, while keeping `reminder_offset_minutes` for recurrence inheritance rather than trying to overload the offset field for absolute capture-time reminder writes.
- Kept Phase 2 extraction synchronous behind the capture submit endpoint so voice/text capture, transcript review, and task creation stay in one bounded user flow without introducing polling or background orchestration early.
- Split capture integrations into a backend orchestration service plus separate transcription and extraction clients so provider failures can be tested independently and routes stay narrow.
- Chose separate review for both voice and text capture, with same-recording voice retry kept in memory on the client rather than persisting raw audio server-side.

## 2026-03-22 16:42:00 EDT

- Implemented Phase 1 auth around backend-owned Supabase PKCE callback handling, secure cookie session storage, request-time JWT validation, and explicit CSRF enforcement instead of relying on browser-managed Supabase sessions.
- Standardized first-login timezone bootstrap on `UTC` until the frontend reports the browser timezone, while keeping the persisted timezone required and user-updatable through the backend session API.
- Landed the first substantive Alembic revision as `0002_phase1_core_backend` and moved the backend startup revision check default to that revision.
- Kept Phase 1 API surface intentionally narrow around `auth/session` behavior and core repositories, leaving task/group CRUD shape decisions for the later product phases that define those contracts.

## 2026-03-22 12:37:17 EDT

- Executed Phase 0 as a true foundation pass and stopped at documented contracts, scaffolds, local-dev plumbing, and baseline checks rather than pulling Phase 1 product behavior forward.
- Chose a no-op Alembic baseline revision in Phase 0 so startup version checks and CI can validate migration wiring before the first substantive schema migration lands in Phase 1.
- Standardized the v1 schema on a dedicated `reminders` table plus typed recurrence columns on `tasks`, instead of inline-only reminder state or JSON-heavy recurrence blobs.
- Enforced group-name uniqueness per user at the schema-contract level to keep extractor `group_name` resolution deterministic.
- Kept local dev aligned to the committed stack by using local Supabase CLI services plus Dockerized frontend/backend app containers, while leaving application auth behavior fail-closed and un-bypassed.

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
