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
- Deployed all four Railway services successfully on Railway-generated domains.
- Configured Resend CLI and verified `gustapp.ca` as the active sending domain.

## Live Service State

- Backend health is live at `https://backend-production-496e.up.railway.app/health`.
- Frontend is live at `https://frontend-production-d3eb.up.railway.app`.
- Daily digest cron service build/deploy succeeded with cron schedule `30 12 * * *`.
- Weekly digest cron service build/deploy succeeded with cron schedule `0 13 * * 0`.
- Manual internal reminder runs succeeded against the live backend:
  - daily: `{"mode":"daily","users_processed":0,"sent":0,"skipped_empty":0,"failed":0,"captures_deleted":0}`
  - weekly: `{"mode":"weekly","users_processed":0,"sent":0,"skipped_empty":0,"failed":0,"captures_deleted":0}`

## Deployment Changes Landed

- Added production-only Railway Dockerfiles and `.dockerignore` files for `frontend/` and `backend/`.
- Corrected backend Railway start command shell expansion for `PORT`.
- Fixed cron Dockerfiles to avoid the `chmod` build failure on `curlimages/curl`.
- Added the previously ignored tracked frontend API/config source files under `frontend/src/lib/` so hosted builds include them.
- Updated Railway service variables for production backend, frontend, and cron runtime.

## Remaining Blockers

- Railway custom domain attachment is still blocked in this environment because `railway domain gustapp.ca ...` and `railway domain api.gustapp.ca ...` keep failing with `Unauthorized` even after successful CLI login and successful deploy/variable calls.
- Supabase custom domain `auth.gustapp.ca` is still blocked because the hosted project is on a plan without the Custom Domain add-on. The management API returns: `Please enable the Custom Domain add-on for the project first.`
- Hosted Google OAuth through Supabase is not yet configured because production Google client credentials are still missing:
  - `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`
  - `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`
- Because those Google credentials are missing, `supabase config push` was intentionally stopped before applying hosted auth changes that would have enabled Google in a broken state.

## Next Steps

1. Provide the production Google OAuth client ID and secret so hosted Supabase Google auth can be configured and pushed safely.
2. Upgrade or enable the Supabase Custom Domain add-on if `auth.gustapp.ca` is still required.
3. Resolve Railway custom-domain attachment either by fixing the CLI auth issue or by attaching `gustapp.ca` and `api.gustapp.ca` outside this CLI session.
4. After domains are attached, switch Railway runtime URLs from provider domains to the required custom domains and rerun login/reminder smoke tests.
