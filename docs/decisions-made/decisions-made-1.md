# Decisions Made

## 2026-03-25 00:10:00 EDT

- Added explicit recurring delete scope at the task API and UI layers: `Delete this occurrence` and `Delete this and future`.
- Chose due-date-based recurrence advancement for occurrence delete (instead of delete-time-based), with generation only when no other open occurrence exists in the series.
- Kept completion as a single action that still generates the next occurrence, and added a dedicated per-group Completed Tasks page with reopen-to-To-do behavior.

## 2026-03-22 22:52:00 EDT

- Switched the OpenRouter extraction default from `openai/gpt-4.1-mini` to `openai/gpt-5.4-mini` after validating that the current route supports structured outputs with the normalized strict schema used by capture submit.

## 2026-03-22 22:37:00 EDT

- Reverted the OpenRouter extraction default from `minimax/minimax-m2.7` to `openai/gpt-4.1-mini` and added strict-schema normalization because the Minimax route advertised `response_format` support but still returned fenced, schema-invalid payloads for capture extraction.

## 2026-03-22 22:23:10 EDT

- Reverted the Mistral transcription default from the invalid `voxtral-mini-transcribe-26-02` identifier to the official `voxtral-mini-latest` alias so `/captures/voice` stays aligned with the published provider model IDs.

## 2026-03-22 22:10:28 EDT

- Switched the default transcription model to Mistral `voxtral-mini-transcribe-26-02` while keeping the existing backend-owned multipart transcription flow and no-raw-audio retention behavior unchanged.
- Switched the default extraction model to OpenRouter `minimax/minimax-m2.7` and kept strict JSON-schema response enforcement in place because the live OpenRouter model metadata advertises `response_format` support.

## 2026-03-22 17:48:11 EDT

- Kept the Phase 4 scheduler on the existing `POST /internal/reminders/run` HTTP route and protected it with a shared-secret header instead of introducing a separate CLI entrypoint or unauthenticated private route.
- Classified reminder delivery failures into retryable versus terminal outcomes, with transient transport/provider issues requeued to `pending` and terminal provider rejections recorded as `failed`.
- Made recurrence generation completion-based in the user's timezone, with monthly rules persisting the generated occurrence day-of-month after month-end clamping and duplicate-series guards preventing extra open occurrences.
- Changed `tasks.capture_id` to use `ON DELETE SET NULL` so bounded capture-retention cleanup can hard-delete expired captures without deleting long-lived task rows.

## 2026-03-22 16:52:45 EDT

- Kept the primary shell limited to `Capture` and `Tasks`, and moved group management into a full-screen Tasks-adjacent route instead of adding a third primary tab.
- Standardized `due_soon` on tasks due today through the next 3 calendar days in the user's timezone, with server-side bucket assignment and sorting treated as authoritative.
- Chose snackbar undo for both task completion and task deletion in Phase 3, backed by explicit reopen and restore endpoints, instead of adding a completed-task browser in this phase.

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
