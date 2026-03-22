# Task Output

## Task

Rewrite and harden the Gust PRD and tech stack documents.

## What Changed

- Reframed the PRD around explicit product contracts instead of high-level feature bullets.
- Added concrete behavior for capture failures, transcript review, review flags, reminders, recurrence, timezone handling, and privacy.
- Reframed the tech stack around committed architecture decisions and rejected drift-prone details such as command lists, speculative folder trees, and auth-bypass dev modes.
- Defined a secure session strategy that avoids localStorage and a backend data-access strategy that does not depend on implicit RLS behavior.

## Follow-Up Needed

- Populate `docs/database_schema.md` with a schema that matches the new contracts.
- Populate `docs/backend-database-migration-runbook.md` with rollout and migration guidance before implementation starts.

## Additional Task

Rewrite the repository `AGENTS.md` files so they match Gust instead of the previous DeepPatient app.

## Additional Changes

- Replaced the root guidance with Gust-specific repo shape, source-of-truth docs, global guardrails, and mandatory bookkeeping instructions.
- Rewrote `frontend/AGENTS.md` around the committed React/Vite/TanStack Query/PWA architecture and the voice-first mobile UX contract.
- Rewrote `backend/AGENTS.md` around the committed FastAPI/SQLAlchemy/Supabase/Mistral/OpenRouter/Resend architecture and the reminder/recurrence/timezone rules in the PRD.
- Removed stale references to nonexistent DeepPatient files, RBAC language, and implementation-path assumptions that do not apply to this repo.

## Additional Major Task

Refine the `AGENTS.md` guidance for local testing and documentation bookkeeping.

## Additional Major Task Changes

- Added an explicit local-testing rule that the repo should support an env-file dev-mode flag which switches testing to a Makefile-managed Docker stack.
- Clarified that local testing must not connect to production Supabase Auth or the production Supabase database.
- Relaxed bookkeeping so only `docs/build-plan.md` is always updated, while `docs/decisions-made/` and `docs/task-output/` are reserved for major decisions and major tasks.
- Added numbered decision-log rollover guidance for `docs/decisions-made/decisions-made-<n>.md`.
