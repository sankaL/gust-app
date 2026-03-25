# Gust Build Plan

This tracker replaces the previous timestamped work log with a phased delivery plan for Gust v1.

All seeded tasks start with `Status = TODO` and `Date = TBD`. Update rows in place as work begins, completes, or is blocked.

## Tracking Conventions

- Task IDs use `P<phase>-<nn>` for planned work, `ADH-<nn>` for ad hoc work, and `BUG-<nn>` for bug fixes.
- `Comments` is optional and should capture blockers, scope notes, or rollout context.
- `Doc Ref` is optional and should point to the source-of-truth docs that govern the task.

## Doc Ref Legend

- PRD = [PRD-Gust.md](./PRD-Gust.md)
- Tech = [Tech-Stack-Gust.md](./Tech-Stack-Gust.md)
- Design = [Design.md](./Design.md)
- Schema = [database_schema.md](./database_schema.md)
- Runbook = [backend-database-migration-runbook.md](./backend-database-migration-runbook.md)
- AGENTS = [AGENTS.md](../AGENTS.md)

## Phase 0: Contracts and Foundation

| Task ID | Task | Status | Date | Comments | Doc Ref |
|---|---|---|---|---|---|
| P0-01 | Populate the schema source of truth for users, Inbox, tasks, subtasks, captures, reminders, recurrence, timezone, and retention | DONE | 2026-03-22 | Normalized schema contract added for v1 foundation | Schema, PRD, Tech |
| P0-02 | Populate the backend/database migration runbook with bootstrap order, rollout checks, rollback notes, and post-deploy verification | DONE | 2026-03-22 | Runbook aligned with local Supabase, Alembic, and rollout checks | Runbook, Schema, Tech |
| P0-03 | Scaffold the frontend app with React, TypeScript, Vite, Tailwind, Router, Query, and PWA foundations | DONE | 2026-03-22 | App shell, providers, routes, tests, and PWA baseline added | Tech, Design |
| P0-04 | Scaffold the backend app with FastAPI, Pydantic v2, SQLAlchemy Core, psycopg, and Alembic | DONE | 2026-03-22 | App factory, placeholder routers, tests, and Alembic baseline added | Tech |
| P0-05 | Add dev-mode local development support with Makefile-managed Docker services and baseline CI/checks | DONE | 2026-03-22 | Makefile, Docker, Supabase config, env examples, and CI added | AGENTS, Tech |

## Phase 1: Auth and Core Backend

| Task ID | Task | Status | Date | Comments | Doc Ref |
|---|---|---|---|---|---|
| P1-01 | Implement Google sign-in with backend-managed secure cookie sessions and CSRF protection | DONE | 2026-03-22 | Supabase PKCE callback, JWT validation, cookie sessions, refresh, logout, and CSRF enforcement added | PRD, Tech |
| P1-02 | Implement initial database migrations and data-access layer for users, groups, tasks, subtasks, captures, and reminders | DONE | 2026-03-22 | Added Phase 1 revision plus SQLAlchemy Core schema metadata and scoped repositories | Schema, Runbook, Tech |
| P1-03 | Implement Inbox bootstrap and user timezone persistence/update flows | DONE | 2026-03-22 | Auth callback bootstraps Inbox and `PUT /auth/session/timezone` persists validated IANA timezones | PRD, Schema |
| P1-04 | Add session/status endpoints plus request IDs, structured logs, and sanitized error handling | DONE | 2026-03-22 | Session bootstrap endpoint, request-id middleware, structured logs, and sanitized handlers added | Tech, AGENTS |

## Phase 2: Capture and Extraction

| Task ID | Task | Status | Date | Comments | Doc Ref |
|---|---|---|---|---|---|
| P2-01 | Build the mobile-first Capture screen with mic controls, recording states, text fallback, cancel, and retry UX | DONE | 2026-03-22 | Signed-in capture route now supports voice recording, permission fallback, transcript review, discard, retry, and inline summaries | PRD, Design |
| P2-02 | Implement audio upload and server-side transcription with bounded timeouts and retry-safe failures | DONE | 2026-03-22 | Added authenticated voice upload endpoint, Mistral client seam, explicit capture failure states, and no raw-audio persistence | PRD, Tech |
| P2-03 | Implement transcript review/edit flow that preserves local edits until submit succeeds or user discards | DONE | 2026-03-22 | Voice and text both route through review state, local edits persist across extraction failures, and discard is explicit | PRD, AGENTS |
| P2-04 | Implement extraction orchestration with structured-output validation, one bounded retry, confidence routing, and result summary | DONE | 2026-03-22 | Added structured extraction service, candidate-level skip disclosure, reminder/subtask persistence, and result summaries | PRD, Tech |

## Phase 3: Tasks, Groups, and Editing UX

| Task ID | Task | Status | Date | Comments | Doc Ref |
|---|---|---|---|---|---|
| P3-01 | Implement tasks and groups API CRUD with explicit user scoping and product sorting semantics | DONE | 2026-03-22 | Added task/group services, authenticated CRUD/lifecycle routes, due-bucket sorting, reminder sync, recurrence `series_id` maintenance, and subtask mutations | PRD, Tech |
| P3-02 | Build grouped task list UI with overdue, due-soon, and no-date ordering plus review indicators | DONE | 2026-03-22 | Replaced the placeholder Tasks screen with signed-in group selection, URL state, bucketed sections, review indicators, and undo-backed task actions | PRD, Design |
| P3-03 | Build task detail editing for title, group, due date, reminder, recurrence, and subtasks | DONE | 2026-03-22 | Added full-screen task detail editing with explicit save, dependent-field clearing, and inline subtask management | PRD |
| P3-04 | Build group management with Inbox protections, reassignment on delete, swipe complete/delete, and review-clear on manual move | DONE | 2026-03-22 | Added Tasks-adjacent group management, Inbox protections, reassignment-on-delete, and undo-backed complete/delete flows | PRD, Design |

## Phase 4: Reminders, Recurrence, and Retention

| Task ID | Task | Status | Date | Comments | Doc Ref |
|---|---|---|---|---|---|
| P4-01 | Implement reminder data model and idempotent reminder worker with transactional claiming | DONE | 2026-03-22 | Protected internal worker route, transactional claiming, retry-safe requeue, and send-result tracking added | PRD, Tech, Schema |
| P4-02 | Integrate Resend for reminder delivery with deterministic idempotency keys and send-result tracking | DONE | 2026-03-22 | Added Resend adapter, deterministic idempotency header use, and provider message-id persistence | PRD, Tech |
| P4-03 | Implement recurrence generation on completion for daily, weekly, and monthly rules | DONE | 2026-03-22 | Completion now creates the next occurrence transactionally, guards duplicate series, and resets subtasks | PRD, Tech |
| P4-04 | Implement bounded capture/transcript retention and cleanup behavior | DONE | 2026-03-22 | Expired capture cleanup added with `tasks.capture_id` retention-safe nulling | PRD, Schema |

## Phase 5: Hardening and Launch Readiness

| Task ID | Task | Status | Date | Comments | Doc Ref |
|---|---|---|---|---|---|
| P5-01 | Finalize PWA manifest, icons, install flow, and app-shell-only service-worker caching | TODO | TBD | Never cache authenticated task data | Tech, Design |
| P5-02 | Add backend automated coverage for auth, extraction validation, reminder idempotency, recurrence, and timezone logic | TODO | TBD | Regression safety requirement | Tech, AGENTS |
| P5-03 | Add frontend automated coverage for capture states, transcript retry, flagged tasks, swipe actions, and auth-gated routing | TODO | TBD | Regression safety requirement | Tech, AGENTS |
| P5-04 | Add end-to-end coverage for sign-in, voice capture, text capture, reminder flow, and install path | TODO | TBD | Use test/local services only | Tech, AGENTS |
| P5-05 | Complete launch hardening for observability, privacy checks, performance targets, and deployment readiness | TODO | TBD | Must meet v1 success metrics | PRD, Tech |
| P5-06 | Implement persistent pending extracted tasks list with user-scoped queries and Railway cron cleanup job | TODO | TBD | Pending tasks accumulate across captures and persist until user approves/discards; cleanup job deletes approved/discarded records after 7 days but never deletes pending | pending-list-redesign-plan.md |

## Ad Hoc Tasks

| Task ID | Task | Status | Date | Comments | Doc Ref |
|---|---|---|---|---|---|
| ADH-01 | Unplanned implementation or documentation work discovered during delivery | DONE | 2026-03-22 | Expanded env example coverage for runtime, frontend, and provider config | AGENTS, Tech |
| ADH-02 | Tooling or workflow improvements needed to unblock delivery | DONE | 2026-03-22 | Added `make dev local` local-stack startup with conditional Alembic upgrades, dynamic port assignment, and ready-state checks | AGENTS, Runbook |
| ADH-03 | Unplanned implementation or documentation work discovered during delivery | DONE | 2026-03-22 | Added Gust logo SVG colorway assets aligned to the sonic minimalist palette | Design |
| ADH-04 | Tooling or workflow improvements needed to unblock delivery | DONE | 2026-03-22 | Unified root env templates, added `.env.prod`, and routed local Docker config through generated runtime env derived from `.env` | AGENTS, Tech |
| ADH-05 | Unplanned implementation or documentation work discovered during delivery | DONE | 2026-03-22 | Switched default transcription and extraction models to Voxtral Mini Transcribe 2 and MiniMax M2.7, with provider request regression coverage | Tech, AGENTS |
| ADH-06 | Implement persistent pending extracted tasks list with user-scoped queries and Railway cron cleanup job | IN PROGRESS | 2026-03-24 | Backend: modified cleanup job to only delete approved/discarded, added /pending-tasks endpoint. Frontend: added listPendingTasks, persistent pending list UI. Database schema docs updated. | pending-list-redesign-plan.md |
| ADH-07 | Enhance task extraction system prompt with multi-task and subtask decomposition guidance | DONE | 2026-03-24 | Added step-by-step extraction strategy, task boundary rules, signal word handling, comprehensive examples including test case, and self-verification checklist to extraction_prompts.py. Added test_extraction_comprehensive.py with regression coverage. | extraction-improvement-plan.md |
| ADH-08 | Implement recurring delete scope and per-group completed tasks page | DONE | 2026-03-25 | Added recurring delete scope (`occurrence` / `series`) with backend lifecycle handling, new completed-tasks route with reopen actions, and regression coverage for recurring delete/restore behavior. | PRD, Tech |

## Bug Fixes

| Task ID | Task | Status | Date | Comments | Doc Ref |
|---|---|---|---|---|---|
| BUG-01 | Capture, transcription, or extraction regression | DONE | 2026-03-22 | Restored the Mistral transcription default to `voxtral-mini-latest`, normalized strict extraction schemas, and switched extraction to `openai/gpt-5.4-mini` after validating it on the current OpenRouter route | PRD, Tech |
| BUG-02 | Intermittent dentist task extraction failure (~90% miss rate) | IN PROGRESS | 2026-03-24 | Root cause: guardrails matching threshold too strict + subtasks not checked. Fix: lowered matching threshold in `_task_matches_intent`, added subtask checking in `find_missing_guarded_intents`, enhanced JSON extraction robustness | extraction_guardrails.py, extraction.py |
| BUG-02 | Task, reminder, recurrence, or auth regression | DONE | 2026-03-22 | Fixed deleted-group reassignment for soft-deleted tasks plus task-list/task-detail frontend regressions, with backend and frontend regression tests | PRD, Tech |
| BUG-03 | Local dev auth regression blocking protected flow testing | DONE | 2026-03-22 | Added backend-mediated local Supabase test-account sign-in, corrected local runtime anon-key wiring, and restored credentialed CORS between the local frontend and backend | Tech, Runbook, AGENTS |
| BUG-04 | Extraction prompt/logging regression | DONE | 2026-03-23 | Passed the system prompt as runtime input so LangChain no longer treats JSON braces as template vars, removed sensitive extraction log fields, and added backend regression coverage | PRD, Tech, AGENTS |
| BUG-05 | Capture staging workflow regressions | DONE | 2026-03-23 | Fixed frontend build blockers, removed CSRF requirement from extracted-task GET listing, replaced staging `ValueError` with API-domain errors, cleared staged rows on re-extract, and blocked completion while pending staged tasks remain | PRD, Tech, AGENTS |
| BUG-06 | Extraction agent missing subtasks and whole tasks from transcripts | DONE | 2026-03-24 | Fixed three root causes: (1) `top_confidence` required with no default causing silent Pydantic validation failure on every LLM response; (2) JSON extraction regex failing on code-fenced output; (3) system prompt examples omitting `top_confidence`, training the model to skip it. All 20 extraction tests pass. | PRD, Tech, AGENTS |
| BUG-07 | Extraction: dentist task still missing 80% of runs; subtasks never stored | DONE | 2026-03-24 | (1) Added mandatory CROSS-DOMAIN CHECK step to system prompt and user prompt to force scanning for health/personal tasks; (2) Fixed JSON extractor to use PASS 2 OUTPUT label as anchor; (3) Added `subtask_titles` JSON column to `extracted_tasks` (migration 0006), wired through repository/staging/approve/API so extracted subtasks are stored and created as real subtask rows on approval. | PRD, Tech, Schema, AGENTS |
| BUG-08 | Extraction silently drops cross-domain tasks despite schema-valid output | DONE | 2026-03-23 | Added deterministic guarded-intent detection, one bounded corrective re-extraction for missing standalone intents, Inbox fallback review-task synthesis when recovery still fails, and backend regression coverage for dentist-call omissions. | PRD, Tech, AGENTS |
| BUG-09 | Capture page shows duplicate extracted tasks after edit during active review | DONE | 2026-03-24 | De-duplicated capture UI by hiding pending tasks for the active `reviewCaptureId` while staging is open, scoped pending bulk actions to visible pending tasks only, removed debug edit-save logs, and added frontend regression tests for dedupe + post-Done restore behavior. | PRD, AGENTS |
| BUG-10 | Recurring task lifecycle regressions (duplicate completion calls and series reactivation on move-back-to-To-do) | DONE | 2026-03-25 | Added open-state completion guard, repaired legacy recurring rows missing `series_id`, ensured move-back-to-To-do reopens only a single non-recurring instance, and added recurring lifecycle regression coverage. | PRD, Tech |
| BUG-11 | Recurring reopen/restore regression after completed-task move-back and historical duplicate completed rows | DONE | 2026-03-25 | Made reopen/restore recurrence detachment conditional so active-series undo paths keep recurrence while no-match paths detach to a single instance; added backend regression coverage and strengthened completed-task UI dedupe for historical duplicate rows. | PRD, Tech |
