# Task Output

## Task

Implement Phase 1: Auth and Core Backend.

## What Changed

- Added the first substantive backend schema revision, `0002_phase1_core_backend`, covering users, groups, tasks, subtasks, captures, reminders, indexes, and core invariants from the schema contract.
- Added SQLAlchemy Core schema metadata plus scoped repositories for user upsert, Inbox bootstrap, session-context resolution, and timezone updates.
- Replaced the placeholder auth route with working `auth/session` endpoints for session status, Google OAuth start, OAuth callback, logout, and timezone updates.
- Added backend-owned session cookies, PKCE state handling, CSRF cookie/header enforcement, request-time JWT validation, refresh-token retry, and logout revocation attempts against Supabase Auth.
- Added request-ID middleware, JSON-style structured logging, and sanitized error handlers for auth, validation, migration mismatch, and unexpected server errors.
- Expanded backend tests to cover callback/bootstrap flow, session status, CSRF protection, refresh behavior, repository invariants, and Phase 1 schema presence.

## Validation

- `make backend-lint`
- `make backend-test`

## Follow-Up Needed

- Phase 2 should attach the new auth/session context to capture and extraction routes instead of leaving those endpoints scaffolded.
- Phase 3 should build on the new repositories with explicit task/group API contracts and sorting semantics.
- End-to-end coverage against a test/local Supabase flow still belongs in the later hardening phase.
