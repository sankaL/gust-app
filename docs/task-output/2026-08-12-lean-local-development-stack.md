# Task Output: Lean Local Development Stack

## Result

Routine `make dev` now starts only PostgreSQL 17, the FastAPI backend, and the Vite
frontend. It no longer installs or starts the Supabase CLI stack, Studio, local mail,
Storage, Realtime, Analytics, or Edge Runtime.

## Local Authentication

- `GUST_DEV_MODE=true` selects a dev-only signed-session issuer.
- `/auth/session/dev-login` issues short-lived access and bounded refresh cookies for the
  fixed `local-dev@gust.local` identity.
- `LOCAL_DEV_AUTH_SECRET` is required and must contain at least 32 characters.
- `APP_ENV=production` rejects `GUST_DEV_MODE=true` during settings validation, and the
  local issuer repeats the check as defense in depth.
- Backend startup adds the fixed identity email to `allowed_users` after Alembic reaches
  head.
- Allowlisting, CSRF, same-origin validation, throttling, cookie protections, and explicit
  user scoping remain active.
- Google OAuth endpoints are hidden in dev mode. Production continues to use Supabase
  Auth without behavioral changes.

## Database and Runtime

- A named Docker volume preserves PostgreSQL data across routine restarts.
- Alembic is the sole application-schema bootstrap path and now idempotently ensures the
  shared `allowed_users` table exists; hosted Supabase migrations still own the provider
  hook and provider-role grants.
- The generated runtime contains stable frontend, backend, and PostgreSQL host ports.
  Occupied ports remain stable when published by the current Compose project, while
  stale ports claimed by another process are replaced with free ports.
- `make dev-down` stops the containers without deleting the database volume.
- `make dev` seeds deterministic dashboard sample data for the local test account only
  when that account has no tasks; the existing `seed-dev-dashboard` target remains
  available for an explicit fixture refresh.

## Verification

- All 226 backend tests and all 164 frontend tests pass.
- Frontend login/routing coverage verifies local-only sign-in in dev mode and Google-only
  sign-in outside dev mode.
- Timezone synchronization coverage verifies bounded timeout, abort-on-unmount, retry,
  and cache refresh behavior; quick-add coverage verifies repeat use after dismissal.
- Docker Compose configuration, Python compilation, frontend lint/build, strict Fallow,
  backend Ruff, backend smoke import, and the complete `make check` gate pass.
- A clean Docker bootstrap migrated plain PostgreSQL through revision
  `0018_ensure_allowed_users`, restored the local session from cookies, and completed a
  CSRF-protected timezone write with HTTP 200 responses.

## Confidence

Confidence is 99%. A dedicated browser end-to-end run of the same local flow would provide
the remaining UI-level confidence beyond the completed container and API checks.
