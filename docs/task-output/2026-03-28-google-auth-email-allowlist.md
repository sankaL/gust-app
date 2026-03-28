# Task Output: Google Auth Email Allowlist

## Date
- 2026-03-28

## Summary
- Added a Supabase-backed email allowlist for private Google auth access.
- Blocked unauthorized account creation before `auth.users` insertion with a `before_user_created` hook.
- Blocked callback/session bootstrap for already-created users whose emails are not currently allowlisted.
- Added login-screen messaging for denied emails and documented the new auth contract.

## Implemented Behavior
- Supabase auth layer:
  - Added `public.allowed_users` as the allowlist source of truth.
  - Added `public.before_user_created_allowlist(event jsonb)` to reject non-allowlisted signups with a sanitized `403` error.
  - Enabled the hook in `supabase/config.toml`.
  - Seeded the initial private-access emails:
    - `admingust@gmail.com`
    - `pavanmanthika@gmail.com`
    - `sanka.lokuliyana@gmail.com`
    - `tabesink@gmail.com`
  - Seeded `local-dev@gust.local` for local dev fallback auth.
- Backend auth/session layer:
  - Added a database lookup helper for allowlisted emails.
  - Callback flow now redirects blocked users to `/login?auth_error=email_not_allowed` without bootstrapping Gust user state.
  - Session refresh/session resolution now clears cookies and returns `403 auth_email_not_allowed` for removed or unauthorized emails.
  - The Supabase allowlist migration conditionally grants `SELECT` on `public.allowed_users` to the production backend runtime role `gust_app_runtime`.
  - Local dev login uses the same allowlist enforcement path.
- Frontend auth UX:
  - Login route now shows a clear allowlist denial message from either `auth_error=email_not_allowed` or a backend `auth_email_not_allowed` response.
  - Session-status queries no longer retry, so blocked users are redirected promptly instead of waiting through retry loops.
- Local runtime tooling:
  - `prepare-runtime.py` now copies `supabase/migrations/` into `.dev-runtime/supabase/` so local Supabase applies auth-hook SQL as well as config and seed data.

## Validation Scope
- Backend:
  - `ruff check app tests`
  - Targeted auth/session test updates were prepared, but local pytest execution is currently blocked in this environment because the available Python runtime is `3.9.6` while the backend codebase depends on Python 3.10+ annotation support used by Pydantic models.
- Frontend:
  - `npm --prefix frontend run test -- --run src/test/app.test.tsx`
  - `npm --prefix frontend run lint`
    - Existing warning remains in `frontend/src/components/AllTasksView.tsx:58` about `react-hooks/exhaustive-deps`; no new frontend lint errors were introduced by this task.

## Operational Notes
- Future allowlist management is data-only:
  - add: `insert into public.allowed_users (email) values ('new@example.com');`
  - remove: `delete from public.allowed_users where email = 'old@example.com';`
- Removing an email takes effect on the next callback or session refresh path; no backend/frontend redeploy is required.
