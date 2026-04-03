# Decisions Made

## 2026-04-03 02:06:00 EDT

- Optimized task loading performance across the full stack to address 2+ second load times with 10+ tasks.
- Backend: added composite partial index `idx_tasks_list_pagination(user_id, status, created_at DESC, id DESC) WHERE deleted_at IS NULL` (migration 0014) to support efficient cursor-based pagination for task list queries.
- Backend: replaced O(n) correlated scalar subquery for subtask counting with a single LEFT JOIN against a pre-aggregated subquery in `list_tasks()`, eliminating per-row subquery executions.
- Backend: changed group lookup in `TaskService.list_tasks()` from fetching ALL user groups to batch-fetching only the groups actually referenced by returned tasks via new `get_groups_by_ids()` repository function.
- Frontend: memoized date calculations (`buildDueLabel`, `buildDueTone`) and formatting functions (`formatRecurrenceLabel`, `formatSubtaskLabel`) in `OpenTaskCard` using `useMemo` to prevent redundant computation on re-renders.
- Frontend: wrapped `OpenTaskCard` with `React.memo` to prevent unnecessary re-renders when props haven't changed.
- Frontend: replaced full DOM rendering of all task cards with window virtualization using `@tanstack/react-virtual`, rendering only ~10-15 visible cards plus overscan instead of 50+.
- Frontend: reduced query invalidation scope in `TasksRoute.tsx` from 6+ queries to 5 targeted queries, removing unnecessary completed-list invalidations after open-task actions.
- Frontend: added skeleton loading states to `AllTasksView` for better perceived performance during initial load.
- Frontend: configured stale-while-revalidate caching (`staleTime: 30s`, `gcTime: 5m`) on both the infinite all-tasks query and the per-group task query to show cached data while fetching fresh data in background.

## 2026-04-02 21:26:00 EDT

- Added yearly recurrence support with a new `recurrence_month` column on both `tasks` and `extracted_tasks` tables, extending the existing `ck_tasks_recurrence_shape` check constraint to require `month` and `day_of_month` together for `yearly` frequency while keeping `weekday` null.
- Yearly recurrence advances by exactly one calendar year from the completed/deleted occurrence date, clamping the day to the last day of the target month (e.g., Feb 29 → Feb 28 in non-leap years) via `calendar.monthrange`.
- The extraction prompt was extended with yearly signal words ("every year", "yearly", "annually", named holidays, tax day, etc.) so the AI can produce `frequency: "yearly"` with `month` and `day_of_month` from voice/text capture.
- Frontend forms (`TaskFormFields`, `TaskForm`, `EditExtractedTaskModal`) were extended with a month dropdown (1–12) alongside the existing day-of-month input for yearly recurrence, following the same conditional rendering pattern as weekly/monthly.
- A critical bug was found and fixed during review: the staging service's `RecurrenceInput` construction was missing the `month` field, which would have caused all yearly tasks from AI extraction to fail validation and be silently dropped.

## 2026-03-28 20:15:00 EDT

- Split deployed database connectivity into two explicit roles: `DATABASE_URL` remains the least-privilege runtime connection, while Alembic now prefers `MIGRATION_DATABASE_URL` for privileged DDL-bearing migrations.
- Made Railway production backend predeploy fail closed when `MIGRATION_DATABASE_URL` is missing, because privilege errors during `alembic upgrade head` are an avoidable configuration failure rather than a runtime surprise.
- Kept local and simpler environments backward-compatible by letting Alembic fall back to `DATABASE_URL` when no separate migration connection is configured.

## 2026-03-28 18:58:01 EDT

- Chose Postgres-backed fixed-window rate limiting as the shared abuse-control path for auth, capture, and general API routes, instead of adding Redis or a CAPTCHA-first flow, so Gust can harden expensive LLM/transcription paths without adding significant user friction or extra infrastructure.
- Added a second backend-owned OAuth `state` cookie check on top of PKCE and paired all unsafe cookie-authenticated methods with same-origin `Origin`/`Referer` validation, because CSRF protection alone was not enough for the tightened browser-session threat model.
- Standardized security hardening around typed input boundaries and redacted operational logging: plain-text fields are normalized and size-bounded at the backend edge, audio uploads are MIME/size-checked before provider calls, and logs keep only sanitized metadata rather than transcript or provider payload content.

## 2026-03-28 17:11:54 EDT

- Chose a dual-layer Google auth allowlist for private access: a Supabase `before_user_created` hook to stop unauthorized `auth.users` creation plus a backend allowlist check on callback and refresh/session resolution so previously-created but now-removed emails still lose access.
- Kept the allowlist as a data-only `public.allowed_users` table with lowercase-trim normalization and no admin UI, so future user additions/removals require SQL only and no code redeploy.
- Treated the allowlist hook as Supabase-managed auth SQL versioned under `supabase/`, while still keeping Alembic as the sole owner of the main Gust application schema.

## 2026-03-28 14:21:00 EDT

- Kept Gust performance work centered on in-memory TanStack Query caching and optimistic cache reconciliation, while continuing to avoid persistent/browser-runtime caching for authenticated task payloads.
- Made `Server-Timing` and structured request timing mandatory on the hot task/capture/session endpoints so frontend-perceived latency and backend-request latency can be compared directly in production.
- Deferred the more complex ranked-query and all-tasks pagination edge-case work behind instrumentation, but still replaced the highest-value backend anti-patterns first: per-request engine construction and per-capture `approve_all` transaction churn.

## 2026-03-28 08:14:00 EDT

- Completed the hosted RLS rollout only after switching the Railway backend runtime off the Supabase `postgres` role, because `postgres` had `BYPASSRLS` and would have silently ignored the new policies.
- Standardized the production application connection on the dedicated login role `gust_app_runtime`, using the Supabase pooler username format `gust_app_runtime.<project-ref>` rather than the bare role name, because the pooler rejected the bare login with `Tenant or user not found`.
- Kept hosted schema changes on Alembic and left the backend predeploy command as `alembic upgrade head`, while treating the runtime-role cutover as a separate production configuration step from the schema migration itself.

## 2026-03-28 07:24:15 EDT

- Enabled and forced Postgres row-level security on all user-owned Gust tables, but kept explicit backend `user_id` filters as the primary correctness path instead of shifting authorization entirely into policies.
- Standardized backend transaction actor context on `app.current_user_id` for authenticated API work and `app.internal_job = true` for digest/cleanup jobs so direct Postgres access remains compatible with RLS.
- Added an explicit production verification rule that the runtime `DATABASE_URL` role must not have `BYPASSRLS`; privileged/admin database access is reserved for migrations and other intentionally trusted maintenance work.

## 2026-03-27 20:05:00 EDT

- Standardized transient user-action feedback on a shared bottom-stacked notification system mounted above routing so notices survive navigation and always render above floating controls like the Tasks FAB.
- Moved undo for task completion and deletion into actionable notifications instead of keeping route-local bottom bars, preserving the product’s visible undo path while allowing multiple pending actions to stack.
- Kept longer-lived workflow panels such as capture summaries and PWA update/install cards inline, but upgraded remaining inline error/validation surfaces to use filled high-contrast containers instead of faint outline-first treatments.

## 2026-03-26 23:54:10 EDT

- Standardized the live production web origins on `https://gustapp.ca` for the frontend and `https://api.gustapp.ca` for the backend after the user attached those Railway custom domains, and dropped the temporary Railway-generated domains from the hosted Supabase auth redirect config.
- Kept Supabase Auth on the provider subdomain `https://tjsmovitybbzgvqtiujr.supabase.co` because the current project plan does not support the `auth.gustapp.ca` custom-domain add-on.
- Configured hosted Google auth through Supabase using the production Google OAuth client and kept the backend callback on `https://api.gustapp.ca/auth/session/callback`, with secure cookies scoped to `.gustapp.ca`.

## 2026-03-26 22:39:24 EDT

- Kept the production backend on Railway service-generated hostname `https://backend-production-496e.up.railway.app` and pointed the cron callers there until `api.gustapp.ca` can be attached, instead of blocking backend/cron bring-up on custom-domain setup.
- Switched Railway production deploys for `frontend/` and `backend/` to explicit production-only Dockerfiles so hosted builds no longer depend on the dev Dockerfiles already present in those directories.
- Treated hosted Supabase database schema ownership as Alembic-only and executed `alembic upgrade head` against the Supabase pooler connection string (`postgres.<ref>@aws-1-ca-central-1.pooler.supabase.com`) after the direct `db.<ref>.supabase.co` hostname failed to resolve from this environment.
- Stopped `supabase config push` before applying hosted auth changes because enabling Google without real `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` would have published a broken provider configuration.
- Recorded the hosted rollout as partially complete rather than done because three external blockers remain outside repo code: Railway custom-domain CLI authorization failures, Supabase custom-domain add-on requirements, and missing Google OAuth client credentials.

## 2026-03-27 14:25:00 EDT

- Replaced per-task reminder email delivery with exactly two digest modes (`daily`, `weekly`) executed through the existing internal backend job route using explicit `mode` selection.
- Kept Railway scheduling split into two cron services (`digest-daily-cron`, `digest-weekly-cron`) as configuration-only callers and rejected a separate cron microservice/container codebase.
- Chose fixed Eastern (`America/New_York`) as the digest period window basis for all users, with manual UTC cron schedule updates at DST transitions captured in the migration runbook.
- Added `digest_dispatches` as the idempotency/audit source of truth per `user + digest_type + period` and cancelled legacy `reminders` rows in `pending/claimed` during migration cutover.

## 2026-03-27 09:40:00 EDT

- Switched frontend auth entry to a dedicated `/login` route and made the main app shell hard-redirect signed-out users there instead of rendering inline session-required states on protected pages.
- Added an authenticated top-right account avatar menu with `Completed Tasks` (all-groups view), `Desktop Mode` placeholder routing, and `Logout`.
- Chose logout-time TanStack Query cache clearing as the client-side isolation boundary so account switches never reuse prior-user cached groups/tasks.
- Enabled local Supabase Google OAuth wiring through Makefile-managed runtime env propagation, while keeping the backend-mediated local test-account sign-in as a dev fallback.

## 2026-03-26 19:59:56 EDT

- Finalized PWA install UX around a persistent app-shell header CTA when install is available, with iPhone-specific fallback instructions when the browser does not expose `beforeinstallprompt`.
- Finalized service-worker updates around an explicit in-app `Update` prompt that reloads only after user confirmation, instead of silent activation.
- Standardized the production PWA asset set on generated PNG icons for Android, maskable installs, and Apple touch icon support while keeping caching limited to app-shell/static assets only.

## 2026-03-25 00:58:00 EDT

- Updated recurring reopen/restore lifecycle semantics to be conditional: keep recurrence when the expected generated undo-target open occurrence is present, otherwise detach to a single non-recurring instance.
- Kept conflict behavior fail-closed when another open occurrence exists but does not match the expected undo-target occurrence.
- Chose UI-only suppression for historical duplicate completed rows caused by prior recurring lifecycle regressions, avoiding backend data mutation.

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
