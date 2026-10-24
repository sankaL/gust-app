# Email + Password Sign-In (Google OAuth Removed)

Date: 2026-10-24

## Summary

- Gust signs in with email + password through Supabase Auth. Google OAuth, its callback, and the PKCE verifier cookie are gone.
- Accounts are created and passwords reset by an administrator in Supabase. There is no public sign-up and no in-app password reset.
- Session handling is unchanged: Supabase access/refresh tokens in HttpOnly cookies, JWKS validation, transparent refresh, CSRF double-submit on writes, the `allowed_users` allowlist, and RLS user scoping.

## API

| Route | Change |
|---|---|
| `POST /auth/session/login` | New. Body `{email, password}`. Returns `SessionStatusResponse` and sets session + CSRF cookies. Returns `404` in dev mode. |
| `GET /auth/session/google/start` | Removed (`404`). |
| `GET /auth/session/callback` | Removed (`404`). |
| `POST /auth/session/dev-login`, `GET /auth/session`, `PUT /auth/session/timezone`, `POST /auth/session/logout` | Unchanged. |

`POST /auth/session/login` outcomes:

| Situation | Response |
|---|---|
| Missing or foreign `Origin` / `Referer` | `403 origin_invalid`; Supabase is not contacted |
| Malformed email or empty password | `422` |
| Supabase `400` (wrong password, unknown email, unconfirmed email) | `401 auth_invalid_credentials`, "Email or password is incorrect." |
| Correct password, email not in `allowed_users` | `403 auth_email_not_allowed`; the new refresh token is revoked and cookies cleared |
| Supabase unavailable / other error | `502 auth_provider_error` |
| Too many attempts from one IP | `429 rate_limit_exceeded` (`auth_entry` policy) |

## Frontend

- `SessionRequiredCard` renders an email + password form outside dev mode (`autocomplete="username"` / `current-password` so password managers work). The password field clears after a failed attempt.
- Dev mode still shows only the Local Dev Account button.
- The "not part of the user list" message moved to `lib/sessionPresentation.ts` and is shared by the landing page, the login route, and the sign-in form.

## Configuration

- `supabase/config.toml`: `[auth] enable_signup = false`, `[auth.external.google] enabled = false`, callback URL removed from `additional_redirect_urls`.
- No Gust env vars changed. `SUPABASE_AUTH_EXTERNAL_GOOGLE_*` values in Supabase are no longer used.

## Rollout

See the runbook's **Auth Cutover (Google OAuth to Email + Password)** section. In short: set passwords on the existing Supabase users (do not recreate them), deploy the backend and frontend together, then disable Google in the hosted Supabase project.

## Verification

- `make backend-test`: 296 passed. `make backend-lint`: clean.
- `npm --prefix frontend run test`: 206 passed. `npm --prefix frontend run lint` and `npm --prefix frontend run build`: clean.
- New coverage: login success/bootstrap, email normalization, wrong password, foreign and missing origin, malformed email, dev-mode 404, preserved timezone, blocked email, `auth_entry` rate limit on the login route, Supabase password-grant request shape, 400 → invalid credentials, outage → upstream error, and frontend form success/failure/blocked flows.
- Not verified against a live Supabase project.
