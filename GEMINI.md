# Gust — Agent Guidance

This repository keeps **agent instructions lean** and focused on **durable ways of working**:
- No setup/run/test commands, ports, or troubleshooting playbooks
- No environment variable lists
- No speculative folder maps or embedded specs that will drift from the source docs

Service-specific guidance lives in:
- `frontend/AGENTS.md`
- `backend/AGENTS.md`

## Repo Shape
- `frontend/` — mobile-first React app for capture, task management, groups, and installable PWA behavior
- `backend/` — FastAPI API for auth/session handling, capture orchestration, task/group writes, and reminders
- `docs/` — source-of-truth product, architecture, design, and implementation records

## Sources of Truth (consult before changing behavior)
- Product contract: `docs/PRD-Gust.md`
- Technical architecture: `docs/Tech-Stack-Gust.md`
- Design system direction: `docs/Design.md`
- Database schema source of truth: `docs/database_schema.md`
- Backend/database migration runbook: `docs/backend-database-migration-runbook.md`
- Task tracking: `docs/build-plan.md`
- Decisions log: `docs/decisions-made/`
- Task implementation notes: `docs/task-output/`

## Global Guardrails (non-negotiables)
- **Fail closed** on missing or invalid auth, config, preconditions, or AI output validation.
- **No secrets or sensitive user data in logs.** Do not log auth tokens, provider credentials, raw provider payloads, or unnecessary transcript/task content.
- **Never store auth tokens in browser localStorage.**
- **No silent failures.** Do not swallow exceptions; return sanitized errors and keep enough context for diagnosis.
- **Explicit user scoping everywhere.** Reads, writes, reminders, and background work must operate on the authenticated user's data only.
- **Bounded async behavior.** Retries, polling, and external calls must have timeouts/backoff and clear stop conditions.
- **Cleanup resources.** Every listener, timer, subscription, recorder, and background handle must be cleaned up.
- **No production debug leftovers.** Avoid ad-hoc console/stdout logging in production paths.
- **Regression safety.** Behavior changes and bug fixes should add or adjust tests once the corresponding test surface exists.

## Change Checklists

### Local Development / Testing
- Local testing must support a dedicated environment feature flag in the env files that switches the app into **dev mode**.
- In dev mode, testing must use the **Makefile-managed local stack**, not hosted production services.
- Dev mode should bring up local Dockerized services for the frontend, backend, and local Postgres-backed database stack needed for testing.
- Do **not** connect local testing flows to production Supabase Auth or the production Supabase database.
- When implementing or validating local test workflows, prefer the Makefile entrypoints as the source of truth over ad-hoc manual startup steps.

### Schema / Data Contract Changes
- Treat `docs/database_schema.md` as the schema source of truth.
- If a change affects schema, compatibility, rollout order, migrations, backfills, retention, or post-deploy verification, update `docs/backend-database-migration-runbook.md` in the same task.
- Keep product and architecture docs in sync when a change affects capture flow, task semantics, reminders, recurrence, timezone handling, or auth/session behavior.

### AI / Capture Behavior Changes
- Capture and extraction behavior must stay aligned with `docs/PRD-Gust.md`.
- If you change transcription, extraction, confidence routing, review semantics, or reminder behavior:
  - update the relevant product or architecture docs
  - add or adjust regression coverage where the codebase supports it
  - record the rationale in the decisions log

### Task Completion Bookkeeping
After completing a task:
1. Update `docs/build-plan.md` with status and timestamp.
2. Update `docs/decisions-made/` only when the task includes a **major decision** or a **major task** worth recording.
3. Update `docs/task-output/` only for a **major task**.
4. Ask me if you are not sure if this is a major task or decision.

### Decision Log File Management
- Decision log files should use the sequence format `decisions-made-1.md`, `decisions-made-2.md`, `decisions-made-3.md`, and so on.
- Write new entries at the **top** of the latest numbered decision log file.
- If the latest decision log file exceeds roughly **1000 lines**, create the next file in sequence and write the new entry there.

## General Behaviour (CRITICAL)
It is okay to say "I don't know" or "I am not sure" when uncertainty is real.
Always tell me how confident you are in your answer (in percentage) and what information would increase confidence.

## Deployments
Use GitHub CLI: https://cli.github.com/
Use Supabase CLI: https://supabase.com/docs/guides/local-development/cli/getting-started
Use Railway CLI: https://docs.railway.com/cli