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
| P0-01 | Populate the schema source of truth for users, Inbox, tasks, subtasks, captures, reminders, recurrence, timezone, and retention | TODO | TBD | Release blocker before coding | Schema, PRD, Tech |
| P0-02 | Populate the backend/database migration runbook with bootstrap order, rollout checks, rollback notes, and post-deploy verification | TODO | TBD | Release blocker before coding | Runbook, Schema, Tech |
| P0-03 | Scaffold the frontend app with React, TypeScript, Vite, Tailwind, Router, Query, and PWA foundations | TODO | TBD | Match committed stack | Tech, Design |
| P0-04 | Scaffold the backend app with FastAPI, Pydantic v2, SQLAlchemy Core, psycopg, and Alembic | TODO | TBD | Match committed stack | Tech |
| P0-05 | Add dev-mode local development support with Makefile-managed Docker services and baseline CI/checks | TODO | TBD | Must not use production services locally | AGENTS, Tech |

## Phase 1: Auth and Core Backend

| Task ID | Task | Status | Date | Comments | Doc Ref |
|---|---|---|---|---|---|
| P1-01 | Implement Google sign-in with backend-managed secure cookie sessions and CSRF protection | TODO | TBD | Fail closed on invalid auth | PRD, Tech |
| P1-02 | Implement initial database migrations and data-access layer for users, groups, tasks, subtasks, captures, and reminders | TODO | TBD | Explicit `user_id` scoping everywhere | Schema, Runbook, Tech |
| P1-03 | Implement Inbox bootstrap and user timezone persistence/update flows | TODO | TBD | Inbox must be non-null and system-managed | PRD, Schema |
| P1-04 | Add session/status endpoints plus request IDs, structured logs, and sanitized error handling | TODO | TBD | No secrets or raw transcript data in logs | Tech, AGENTS |

## Phase 2: Capture and Extraction

| Task ID | Task | Status | Date | Comments | Doc Ref |
|---|---|---|---|---|---|
| P2-01 | Build the mobile-first Capture screen with mic controls, recording states, text fallback, cancel, and retry UX | TODO | TBD | Voice first, text secondary | PRD, Design |
| P2-02 | Implement audio upload and server-side transcription with bounded timeouts and retry-safe failures | TODO | TBD | Do not retain raw audio | PRD, Tech |
| P2-03 | Implement transcript review/edit flow that preserves local edits until submit succeeds or user discards | TODO | TBD | No silent data loss | PRD, AGENTS |
| P2-04 | Implement extraction orchestration with structured-output validation, one bounded retry, confidence routing, and result summary | TODO | TBD | Partial-invalid items must be disclosed | PRD, Tech |

## Phase 3: Tasks, Groups, and Editing UX

| Task ID | Task | Status | Date | Comments | Doc Ref |
|---|---|---|---|---|---|
| P3-01 | Implement tasks and groups API CRUD with explicit user scoping and product sorting semantics | TODO | TBD | Includes open/completed lifecycle rules | PRD, Tech |
| P3-02 | Build grouped task list UI with overdue, due-soon, and no-date ordering plus review indicators | TODO | TBD | Mobile-first interaction model | PRD, Design |
| P3-03 | Build task detail editing for title, group, due date, reminder, recurrence, and subtasks | TODO | TBD | No nested subtasks or rich notes | PRD |
| P3-04 | Build group management with Inbox protections, reassignment on delete, swipe complete/delete, and review-clear on manual move | TODO | TBD | Preserve Inbox invariants | PRD, Design |

## Phase 4: Reminders, Recurrence, and Retention

| Task ID | Task | Status | Date | Comments | Doc Ref |
|---|---|---|---|---|---|
| P4-01 | Implement reminder data model and idempotent reminder worker with transactional claiming | TODO | TBD | Safe to retry and overlap | PRD, Tech, Schema |
| P4-02 | Integrate Resend for reminder delivery with deterministic idempotency keys and send-result tracking | TODO | TBD | One reminder per occurrence | PRD, Tech |
| P4-03 | Implement recurrence generation on completion for daily, weekly, and monthly rules | TODO | TBD | Only one future open occurrence per series | PRD, Tech |
| P4-04 | Implement bounded capture/transcript retention and cleanup behavior | TODO | TBD | Initial target is 7-day retention | PRD, Schema |

## Phase 5: Hardening and Launch Readiness

| Task ID | Task | Status | Date | Comments | Doc Ref |
|---|---|---|---|---|---|
| P5-01 | Finalize PWA manifest, icons, install flow, and app-shell-only service-worker caching | TODO | TBD | Never cache authenticated task data | Tech, Design |
| P5-02 | Add backend automated coverage for auth, extraction validation, reminder idempotency, recurrence, and timezone logic | TODO | TBD | Regression safety requirement | Tech, AGENTS |
| P5-03 | Add frontend automated coverage for capture states, transcript retry, flagged tasks, swipe actions, and auth-gated routing | TODO | TBD | Regression safety requirement | Tech, AGENTS |
| P5-04 | Add end-to-end coverage for sign-in, voice capture, text capture, reminder flow, and install path | TODO | TBD | Use test/local services only | Tech, AGENTS |
| P5-05 | Complete launch hardening for observability, privacy checks, performance targets, and deployment readiness | TODO | TBD | Must meet v1 success metrics | PRD, Tech |

## Ad Hoc Tasks

| Task ID | Task | Status | Date | Comments | Doc Ref |
|---|---|---|---|---|---|
| ADH-01 | Unplanned implementation or documentation work discovered during delivery | TODO | TBD | Add concrete scope when raised | - |
| ADH-02 | Tooling or workflow improvements needed to unblock delivery | TODO | TBD | Keep separate from feature scope | AGENTS |

## Bug Fixes

| Task ID | Task | Status | Date | Comments | Doc Ref |
|---|---|---|---|---|---|
| BUG-01 | Capture, transcription, or extraction regression | TODO | TBD | Link failing flow or test when opened | PRD, Tech |
| BUG-02 | Task, reminder, recurrence, or auth regression | TODO | TBD | Link failing flow or test when opened | PRD, Tech |
