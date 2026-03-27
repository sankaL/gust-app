# Task Output: Google-First Auth, Account Menu, and Dev OAuth Enablement

## Date
- 2026-03-27

## Summary
- Added a dedicated `/login` route and made the authenticated app shell fail closed by redirecting signed-out access from protected routes.
- Added a top-right account avatar menu with:
  - `Completed Tasks` (opens all-groups completed view)
  - `Desktop Mode` (placeholder route)
  - `Logout` (backend session revoke + client cache clear)
- Updated completed-task behavior to support `group=all` while preserving explicit per-group flows.
- Updated local development auth wiring so `make dev` can boot local Supabase Google OAuth (with optional backend-mediated local test-account fallback).

## Implemented Behavior
- Frontend auth entry:
  - `/login` always shows Google sign-in.
  - Dev mode additionally shows `Continue with Local Test Account`.
- Protected shell behavior:
  - `AppShell` checks session state and redirects signed-out users to `/login?next=...`.
- Account menu behavior:
  - Avatar circle renders user initials.
  - Completed action navigates to `/tasks/completed?group=all`.
  - Desktop action navigates to `/desktop`.
  - Logout calls `POST /auth/session/logout` with CSRF and clears TanStack Query cache before redirecting to `/login`.
- Local Supabase wiring:
  - Added `[auth.external.google]` block in `supabase/config.toml`.
  - Runtime env now supports:
    - `SUPABASE_AUTH_EXTERNAL_GOOGLE_ENABLED`
    - `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`
    - `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`
  - `prepare-runtime.py` now renders local redirect allow-list with frontend URL plus backend callback URL.
  - `make supabase-start` now loads `.dev-runtime/runtime.env` into the `supabase start` process environment.

## Validation Scope
- Added/updated frontend tests for:
  - signed-out protected-route redirect to `/login`
  - login route CTA behavior in dev vs non-dev
  - account menu navigation (`Completed Tasks`, `Desktop Mode`)
  - logout API call + redirect
  - user-isolation regression (user A logout -> user B login without stale task cache reuse)
  - completed-task all-groups query behavior (`group=all`)

## Notes
- Backend already enforced user-scoped data access and secure cookie session handling; this task focused on frontend flow, local OAuth wiring, and cache-isolation ergonomics.
