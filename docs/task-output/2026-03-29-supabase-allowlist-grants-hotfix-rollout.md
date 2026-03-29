# 2026-03-29 Supabase Allowlist Grants Hotfix Rollout

## Outcome

- Pushed branch `codex/hotfix-5` and merged PR `#21` into `main`.
- Merge commit on `main`: `799d5c1` (`fix(db): guard allowlist runtime grants`)
- Applied the linked hosted Supabase migration `20260328214500_harden_allowed_users_grants.sql` to project `gust-prod` (`tjsmovitybbzgvqtiujr`).

## Backup

- Captured a fresh schema dump before the hosted migration: `/tmp/gust-prod-backup-20260329.sql`
- Captured a fresh data dump before the hosted migration: `/tmp/gust-prod-backup-20260329-data.sql`

## Evidence

- `python3 -m pytest backend/tests/test_migrations.py` passed before release.
- GitHub PR `#21` is merged and `main` now points to `799d5c1`.
- `npx supabase migration list` showed `20260328214500` as pending before rollout.
- `npx supabase db push --linked` applied `20260328214500_harden_allowed_users_grants.sql`.

## Notes

- No backend, frontend, or Railway service redeploy was required for this hotfix because the runtime code on `main` did not change beyond tests and release bookkeeping.
