# 2026-04-27 Railway Production Rollout: main@79010a9

## Outcome

- Redeployed the merged `main` release for commit `79010a9` to Railway production.
- Rolled the backend and frontend services only; the digest cron services were unchanged.
- Verified `https://api.gustapp.ca/health`, `https://gustapp.ca`, and `https://www.gustapp.ca` return HTTP 200 after the rollout.
- Confirmed the daily and weekly digest cron services remained `SUCCESS` and on the expected schedules.

## Evidence

- Backend deployment ID: `b8cbbb5e-89e2-4d49-b9d7-c1897951f401`
- Backend deployment status: `SUCCESS`
- Backend deployment created at: `2026-04-28T00:38:05.064Z`
- Frontend deployment ID: `eac218f1-09f4-4a3f-b0fd-c457405a542a`
- Frontend deployment status: `SUCCESS`
- Frontend deployment created at: `2026-04-28T00:38:16.691Z`
- Backend service status: `SUCCESS`
- Frontend service status: `SUCCESS`
- Daily digest deployment ID: `97fc7dfe-adec-4007-9251-31963fee0193`
- Weekly digest deployment ID: `d23a17e9-b045-428e-aaf7-30d54daa2d93`

## Notes

- No Supabase or Alembic migration was required for this release.
- The initial Railway upload for backend and frontend used the wrong archive root and failed to package the repo correctly. Re-running `railway up` with `--path-as-root --no-gitignore` fixed the upload so Railway built the service directories directly.
- Backend predeploy still runs `alembic upgrade head` and the container reached a successful start/health-check cycle.
