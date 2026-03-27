# Tech Stack: Gust

**Version:** 2.0  
**Last Updated:** 2026-03-27  
**Domain:** gustapp.ca

## Purpose

This document defines the committed implementation architecture for Gust v1. It intentionally focuses on durable decisions and operational contracts, not setup commands, file trees, or environment variable inventories.

## Architecture Summary

Gust is a mobile-first web application with:

- a React frontend
- a FastAPI backend
- Supabase-hosted Postgres and Google OAuth
- server-side integrations for transcription, extraction, and digest email delivery

The frontend talks only to the backend API. It does not call the database, transcription provider, extraction provider, or email provider directly.

## Stack Decisions

| Layer | Choice | Why |
|---|---|---|
| Frontend app | React + TypeScript + Vite | Stable SPA stack with good mobile PWA support |
| Routing | React Router | Small, familiar routing layer for a two-screen app |
| Server state | TanStack Query | Reliable fetch/mutation state, retries, and cache invalidation |
| Styling | Tailwind CSS + CSS variables | Fast implementation with a tokenized visual system |
| PWA | `vite-plugin-pwa` | Manifest + service worker support in the Vite ecosystem |
| Backend API | FastAPI + Pydantic v2 | Good typed contracts and async request handling |
| Database access | SQLAlchemy 2.x Core + `psycopg` | Explicit SQL, transactions, migrations, and parameter safety |
| Migrations | Alembic | Standard schema migration workflow |
| Auth provider | Supabase Auth with Google OAuth | Managed identity for a single-user-per-account app |
| Database | Supabase Postgres | Managed Postgres with backups and hosted auth adjacency |
| Transcription | Mistral transcription API | Current hosted transcription API with direct audio support |
| Extraction | OpenRouter-backed LLM with JSON-schema structured outputs | Provider flexibility without sacrificing typed output |
| Email | Resend | Simple transactional email API with idempotency support |
| Hosting | Railway | Simple deployment for the API, frontend, and scheduled jobs |

Production topology:

- frontend served from `https://gustapp.ca`
- backend served from `https://api.gustapp.ca`
- Supabase Auth and project APIs served from `https://auth.gustapp.ca` after custom-domain activation
- Railway deployment config lives alongside each deployable unit:
  - `frontend/railway.json`
  - `backend/railway.json`
  - `deploy/digest-daily-cron/railway.json`
  - `deploy/digest-weekly-cron/railway.json`

## Principles

- Prefer direct, simple integrations over abstraction-heavy frameworks.
- Keep all secrets and AI provider calls on the server.
- Use typed contracts at every boundary.
- Design scheduled work to be idempotent and safe to retry.
- Do not depend on browser localStorage for auth tokens.
- Do not depend on implicit Supabase RLS behavior for backend correctness.

## Frontend Architecture

### Framework

The frontend is a React SPA written in TypeScript.

Responsibilities:

- Authentication entry and session-aware routing
- Protected app-shell redirect to `/login` when signed out
- Voice capture via browser APIs
- Transcript review and submission
- Task list rendering and editing
- Per-group completed-task browsing and reopen actions
- Account-menu all-groups completed-task entry (`/tasks/completed?group=all`)
- Completed-task rendering with legacy duplicate suppression for known historical recurrence regressions
- Group management
- PWA install experience

### State Model

Use three categories of client state:

- URL state for screen selection and filters
- local component state for transient UI such as recording, swipe affordances, and transcript edits
- TanStack Query for all server-backed data

### Audio Capture

Browser APIs:

- `MediaRecorder` for recording
- `getUserMedia` for microphone access
- optional `Permissions API` checks for permission-aware UI

Frontend requirements:

- do not upload partial audio chunks for v1
- upload audio only after user stops recording
- preserve the edited transcript locally until submission succeeds or the user discards it

### Styling

Styling is implemented with Tailwind plus CSS custom properties for design tokens. The visual language must follow [docs/Design.md](/Users/sankal/Documents/professional/gust-app/docs/Design.md), not ad hoc component-library defaults.

This means:

- dark, layered surfaces
- large touch targets
- expressive typography
- custom task toggles and mic treatment

### PWA

Use `vite-plugin-pwa` to generate and register the service worker and manifest.

PWA scope for v1:

- installable on iOS and Android
- offline app shell only
- no offline writes
- clear update behavior when a new build is available

Service worker caching must be limited to:

- app shell assets
- static icons and manifest

Do not cache authenticated API responses containing task data.

## Authentication Architecture

### Provider

Supabase Auth handles Google OAuth.

### Session Storage

Auth tokens must be stored in secure cookies, not in browser localStorage.

Committed model:

- Google OAuth flow completes through Supabase
- backend exchanges and manages the session
- browser receives `Secure`, `HttpOnly` session cookies on the app domain
- unsafe HTTP methods require CSRF protection

The frontend learns whether the user is signed in by calling the backend session endpoint, not by reading tokens from browser storage.
Logout must clear client-side query caches before the next account signs in so stale user data is not reused.

### Backend Auth Handling

On each authenticated request, the backend:

1. reads the access token from the secure cookie
2. validates it against Supabase
3. resolves the authenticated user ID
4. rejects the request if validation fails

The backend is the only trusted access layer for application data.

## Backend Architecture

### API Shape

The backend is a REST API with narrowly scoped resources:

- auth/session
- captures
- tasks
- groups
- internal digest jobs

### Service Modules

Keep backend code separated by responsibility:

- auth/session handling
- capture orchestration
- transcription client
- extraction client
- task write logic
- digest delivery
- recurrence generation

Avoid large “god modules” and keep source files under repository limits.

### Database Access

The backend connects directly to Postgres using a dedicated application role.

Correctness rules:

- every query is parameterized
- every task/group/capture query is explicitly scoped by `user_id`
- backend authorization must not rely on implicit RLS behavior
- if RLS is enabled on tables, treat it as defense in depth, not as the only guard

This is deliberate because Supabase service access can bypass RLS, and relying on undocumented request-context magic would make the system brittle.

### ORM Strategy

Use SQLAlchemy Core style for explicitness and smaller query surfaces. Do not start with a heavy ORM object graph for this app.

Use Pydantic models for:

- request validation
- response serialization
- extractor payload validation

### Migrations

Use Alembic for schema migrations. The application must fail closed if the database is not at the required migration level.

## AI Integration Architecture

### Design Choice

Do not use LangChain for v1.

Reason:

- the workflow is narrow
- prompt construction is simple
- structured output validation is more important than orchestration abstractions
- a thin provider adapter is easier to test and easier to replace

### Transcription

Use Mistral's audio transcription endpoint as the initial speech-to-text provider.

Current default model alias: `voxtral-mini-latest`.

Operational contract:

- audio is uploaded from backend to provider
- provider response returns transcript text
- raw audio is discarded after processing
- transcription latency and failures are logged without logging the transcript body

### Extraction

Use an OpenRouter-backed model that supports JSON-schema structured outputs.

Model selection is an operational setting, not a product contract. The required capabilities are:

- strong extraction from messy short-form input
- reliable date normalization
- JSON-schema structured outputs
- acceptable latency for synchronous task creation

Current default model: `openai/gpt-5.4-mini`.

Backend behavior:

- construct prompt from transcript, user timezone, groups, descriptions, and recent tasks
- request strict JSON-schema output
- validate every returned task candidate with Pydantic
- perform one bounded retry on malformed full-payload output
- run a deterministic guarded-intent completeness check for medical calls, appointments, communication tasks, and similar standalone errands
- perform one bounded corrective re-extraction when a guarded intent is missing from the extracted tasks (including subtasks)
- synthesize a low-confidence Inbox review task when the guarded intent still cannot be recovered after the corrective retry

Do not rely on regex cleanup or permissive JSON repair as the main parsing strategy.

## Digest and Recurrence Processing

### Scheduler

Use Railway cron services for scheduled work.

This fits Gust because the digest worker is a short-lived backend job that should start, process the selected digest mode, and exit.

Constraints to design around:

- Railway cron cadence is not more frequent than every 5 minutes
- schedules are UTC-based
- jobs must exit cleanly or future runs may be skipped

Committed cron split:

- `digest-daily-cron` calls `POST /internal/reminders/run?mode=daily`
- `digest-weekly-cron` calls `POST /internal/reminders/run?mode=weekly`
- both jobs use the same shared-secret header as other internal jobs
- no separate cron microservice codebase is required; this is deployment configuration only
- each cron service is deployed from a dedicated Railway service directory with its own `cronSchedule`

### Digest Delivery

Digest processing must be idempotent and backend-owned.

Required behavior:

- run one explicit mode per invocation: `daily` or `weekly`
- compute period windows in fixed Eastern timezone (`America/New_York`)
- send at most one digest email per user per digest type and period
- use deterministic idempotency keys per `user + digest_type + period`
- send through Resend
- record dispatch outcome as `sent`, `failed`, or `skipped_empty`
- skip sending when the digest is empty
- retry transient send failures without duplicate-send

Per-item reminder rows remain in the schema for compatibility but are no longer the active send path.

### Recurrence

Recurring task generation is handled server-side when a recurring task is completed.

Required behavior:

- completion and next-occurrence creation happen in one transaction
- only one future open occurrence exists per series
- recurrence calculation uses the user's timezone
- daily recurrence advances to the next local calendar day after completion
- monthly recurrence persists the generated occurrence day-of-month after month-end clamping
- generated occurrences clear `reminder_at` when the inherited timestamp is already in the past
- deleting one recurring occurrence can generate the next occurrence from the deleted due date when no other open occurrence exists
- deleting recurring `this and future` soft-deletes all open occurrences in the series and keeps completed history untouched
- reopening/restoring recurring tasks keeps recurrence only when the expected generated undo-target open occurrence is present; otherwise the reopened/restored task detaches into a single non-recurring instance

### Retention Cleanup

Bounded retention cleanup runs in the same scheduled worker execution.

Required behavior:

- delete expired capture rows in bounded batches
- preserve tasks by nulling `tasks.capture_id` when the source capture is removed

## Data Model Expectations

The schema source of truth should live outside this document, but the stack assumes the database can represent:

- users and their timezone
- a non-null system Inbox group per user
- tasks with group ownership, review state, due date, reminder state, and recurrence metadata
- subtasks
- capture records with bounded-retention transcript storage
- digest dispatch state and idempotency markers

If the schema cannot represent those contracts cleanly, the product spec is not implementable.

## Security and Privacy

### Security

- No application secrets in frontend code.
- No direct browser access to privileged database or provider APIs.
- No auth token storage in localStorage.
- All mutating routes require CSRF protection in addition to auth cookies.
- All SQL must be parameterized.

### Privacy

- Do not log transcripts or digest email bodies in plaintext.
- Do not store raw audio after transcription.
- Keep capture retention bounded.
- Keep digest email content minimal.

## Observability

Use structured logs with request IDs and task/capture IDs.

Log:

- auth failures
- provider latency
- extractor validation failures
- digest dispatch outcomes
- recurrence generation outcomes

Do not log:

- raw audio
- auth tokens
- full transcript text
- full digest email bodies

## Testing Requirements

### Backend

Required automated coverage:

- auth rejection and cookie/CSRF behavior
- confidence-routing logic
- extractor payload validation
- partial-invalid-item handling
- digest idempotency
- recurrence generation rules
- timezone-aware relative date resolution

### Frontend

Required automated coverage:

- capture state transitions
- transcript review and retry flows
- flagged-task UI
- swipe interactions
- auth-gated navigation

### End-to-End

Required end-to-end coverage:

- Google sign-in happy path in a test environment
- local dev Google sign-in through local Supabase OAuth config, with optional backend-mediated local test-account fallback
- voice capture with mocked transcription response
- text capture fallback
- digest job flow with mocked Resend provider

Every bug fix touching capture, routing, digests, or recurrence must add or update a regression test.

## Explicitly Rejected Options

- Browser localStorage auth sessions
- Direct frontend reads/writes to the database
- In-process always-on schedulers for digest delivery
- LangChain in the first implementation
- “DEV_MODE” code paths that bypass auth in the application itself
- Schema designs where Inbox is represented by `NULL`

## Pre-Implementation Follow-Ups

Before coding starts, align the following source-of-truth docs with this stack:

- `docs/database_schema.md`
- `docs/backend-database-migration-runbook.md`

Those documents are currently not carrying the contracts required by this architecture.
