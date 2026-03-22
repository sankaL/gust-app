# Backend — Agent Guidance

Keep this file focused on **durable backend engineering rules** for Gust. Do not add setup commands, ports, env-var instructions, or speculative module maps.

## Sources of Truth
- Product behavior and data contracts: `docs/PRD-Gust.md`
- Backend architecture: `docs/Tech-Stack-Gust.md`
- Database schema source of truth: `docs/database_schema.md`
- Backend/database migration runbook: `docs/backend-database-migration-runbook.md`

## Backend Commitments
- Follow the committed stack: FastAPI, Pydantic v2, SQLAlchemy Core with `psycopg`, Alembic, Supabase Auth with Google OAuth, Mistral transcription, OpenRouter structured extraction, and Resend reminders.
- Keep the API surface aligned with the committed resources:
  - auth/session
  - captures
  - tasks
  - groups
  - internal reminder jobs
- Keep route handlers narrow and push orchestration/business logic into dedicated services as the codebase grows.
- Local development and testing should support an env-driven dev mode that uses the Makefile-managed Docker stack and local database services instead of hosted production infrastructure.

## Security & Correctness (non-negotiables)
- Every data read/write must be explicitly scoped by authenticated `user_id`.
- Backend correctness must **not** rely on implicit Supabase RLS behavior; treat RLS as defense in depth if present.
- Use backend-managed secure cookie sessions. Unsafe HTTP methods require CSRF protection.
- Missing or invalid auth/config/permissions must fail closed.
- Use parameterized SQL only; never interpolate runtime identifiers unless they come from an explicit allowlist.
- Sanitize errors and keep secrets, raw provider payloads, and unnecessary transcript content out of logs.
- Do not allow local testing in dev mode to connect to production Supabase Auth or the production Supabase database.

## Capture, Extraction, and Task Writes
- Validate transcription and extraction inputs/outputs at typed boundaries before writing any task data.
- If extractor output is malformed at the full-payload level, allow at most one bounded retry.
- Reject invalid task candidates individually when possible; never silently create malformed data.
- Confidence routing, Inbox fallback, review flags, reminders, recurrence, and timezone resolution must stay aligned with `docs/PRD-Gust.md`.
- Never invent new groups during extraction.

## Reminders, Recurrence, and Async Work
- Reminder delivery must be idempotent and safe to retry.
- Recurrence logic for v1 is limited to daily, weekly, and monthly behavior described in `docs/PRD-Gust.md`.
- Timezone-aware date resolution and reminder processing must use the persisted user timezone.
- External calls and background jobs must have timeouts, bounded retries, and explicit cancellation/cleanup behavior.

## Schema & Migration Discipline
- Any schema-impacting change must update `docs/database_schema.md`.
- Any change affecting migrations, backfills, bootstrap, compatibility, rollout order, or post-deploy verification must update `docs/backend-database-migration-runbook.md` in the same task.
- Keep schema, runtime behavior, and documentation aligned; do not let implementation drift ahead of the contract docs.
