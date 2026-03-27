# 2026-03-26 Production Rollout: Railway + Supabase + Resend

## Outcome

- Promoted and pushed the deployment rollout commits to `main`.
- Provisioned a fresh hosted Supabase project:
  - project ref: `tjsmovitybbzgvqtiujr`
  - region: `ca-central-1`
- Linked the repo to the hosted Supabase project and fetched hosted API keys.
- Ran Alembic against the hosted Supabase Postgres pooler and upgraded the production schema through `0008_digest_dispatches`.
- Provisioned a new Railway project `gust-prod` with four services:
  - `backend`
  - `frontend`
  - `digest-daily-cron`
  - `digest-weekly-cron`
- Deployed all four Railway services successfully and moved the web app onto custom Railway domains:
  - frontend: `https://gustapp.ca`
  - backend: `https://api.gustapp.ca`
- Configured Resend CLI and verified `gustapp.ca` as the active sending domain.
- Configured hosted Supabase Google auth with the production Google OAuth client and updated hosted redirect URLs to the live Railway custom domains.

## Live Service State

- Backend health is live at `https://api.gustapp.ca/health`.
- Frontend is live at `https://gustapp.ca`.
- Daily digest cron service build/deploy succeeded with cron schedule `30 12 * * *`.
- Weekly digest cron service build/deploy succeeded with cron schedule `0 13 * * 0`.
- Manual internal reminder runs succeeded against the live backend:
  - daily: `{"mode":"daily","users_processed":0,"sent":0,"skipped_empty":0,"failed":0,"captures_deleted":0}`
  - weekly: `{"mode":"weekly","users_processed":0,"sent":0,"skipped_empty":0,"failed":0,"captures_deleted":0}`
- Google sign-in initiation now redirects through hosted Supabase with:
  - `redirect_to=https://api.gustapp.ca/auth/session/callback`
  - secure cookies scoped to `.gustapp.ca`

## Deployment Changes Landed

- Added production-only Railway Dockerfiles and `.dockerignore` files for `frontend/` and `backend/`.
- Corrected backend Railway start command shell expansion for `PORT`.
- Fixed cron Dockerfiles to avoid the `chmod` build failure on `curlimages/curl`.
- Added the previously ignored tracked frontend API/config source files under `frontend/src/lib/` so hosted builds include them.
- Updated Railway service variables for production backend, frontend, and cron runtime.
- Updated Supabase hosted auth config so Google OAuth uses the production client and the live app domains.

## Remaining Blockers

- Supabase custom domain `auth.gustapp.ca` is still blocked because the hosted project is on a plan without the Custom Domain add-on. The management API returns: `Please enable the Custom Domain add-on for the project first.`

## Next Steps

1. Add your Gmail address to Google Cloud `Audience -> Test users` if the OAuth app is still in Testing.
2. Sign in at `https://gustapp.ca` to create the first Supabase/Auth user and bootstrap the Gust app user record.
3. Upgrade or enable the Supabase Custom Domain add-on if `auth.gustapp.ca` is still required.
