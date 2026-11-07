# Muse MCP Agent Access

Completed in code 2026-11-07. Not deployed, not committed. Plan: [muse-mcp-agent-access-plan.md](../plans/muse-mcp-agent-access-plan.md).

## What was built

All three phases from the plan in one change (ADH-101, ADH-102, ADH-103):

- **Schema (`0020_mcp_agent_access`):** `users.mcp_enabled` and `mcp_enabled_at`; `mcp_access_tokens` (hashed per-user tokens); `mcp_audit_events` (one row per write, IDs and codes only). Both tables have forced RLS and least-privilege grants. A select-only policy serves the new token-lookup actor (`app.mcp_token_lookup`).
- **Settings API (`/settings/agent-access`):** read the state, turn access on or off (off revokes every token), create a token (shown once, `Cache-Control: no-store`, max 5 active, 30/90/365-day expiry), revoke a token, and list recent agent activity. Cookie session plus CSRF only.
- **MCP endpoint (`POST /mcp`):** MCP Python SDK `mcp` 2.3.0, stateless Streamable HTTP with JSON responses, mounted in the existing backend behind `MCP_SERVER_ENABLED`.
  - Only `/mcp` and the RFC 9728 metadata path are routed to it.
  - Bearer verification fails closed. Cookies are ignored.
  - The Host allowlist comes from `MCP_PUBLIC_URL`, and any browser `Origin` gets a 403.
- **17 tools:**
  - Read: `get_context`, `list_groups`, `list_tasks` (new due-date range and no-date filters), `get_task`
  - Write: `create_task` (with subtasks), `create_tasks` (all or nothing), `update_task` (partial, with `clear`), `complete_task` (returns the next recurring occurrence), `reopen_task`, `restore_task`, `add_subtask`, `update_subtask`, `create_group`, `update_group`
  - Destructive: `delete_task` (soft), `delete_subtask`, `delete_group` (destination required)
  - All creates take an `idempotency_key`.
- **Guards and limits:**
  - Write tools refuse read-only tokens.
  - Per-token rate limits: reads 120/min; writes 30/min and 500/day.
  - Every write records an audit row with outcome `ok`, `error` or `denied`. The digest runs purge rows older than 90 days.
  - Logs carry tool, token ID, outcome and duration only.
- **Frontend:** Settings → Agent access (MCP), hidden unless the server reports `available`.
  - An on/off switch, with a confirmation before turning off.
  - A token list with access level, last used, expiry and a Revoke button.
  - A Generate token sheet with name, Read only / Read & write, and expiry choices.
  - A one-time reveal showing the token, endpoint URL and a ready-made Muse setup message, each with copy.
  - A recent agent activity list.
- **Ops:**
  - The RLS check script covers the new tables and the select-only lookup policy.
  - The deploy script has an opt-in `MCP_VERIFY=true` check that unauthenticated `POST /mcp` returns 401.
  - `.env.example`, `docker-compose.yml` and the dev runtime script carry the new variables. MCP is on by default locally.

- **Fix found along the way:** subtasks created together (capture approval and the new `create_task`) could come back in random order. They shared one `created_at`, because Postgres `CURRENT_TIMESTAMP` is the transaction start, and the random ID broke the tie. `create_subtasks` now stamps them one microsecond apart, so they keep the order given.

## Verification

- **Backend:** 319 pytest tests pass. That includes 27 new MCP tests (Settings routes, auth failures, Host 421, Origin 403, every tool, cross-user isolation, idempotency, batch all-or-nothing, rate limits, activity, purge, and the official MCP client end to end) and a new migration test.
  - One test fails and predates this change: `test_previous_keys_setting_parses_csv` needs `APP_ENV` from a local env file. It fails the same way with this work stashed.
  - `ruff check app tests` is clean.
- **Real Postgres 17:** `alembic upgrade head` applied `0020` on a throwaway container, with a non-bypass `gust_app_runtime` role mirroring production grants.
  - Checked: forced RLS, grants and policies.
  - Checked: no actor sees zero tokens, the lookup actor can read tokens but not update them or see users, user B sees only their own tokens, and B cannot write an audit row that points at A's token.
  - Checked: every operation ran end to end.
  - `scripts/prod/check-postgres-rls.py` passed.
- **Live server:** uvicorn on that database with startup revision checks on.
  - curl got 401 with the challenge, the metadata, 403 for an Origin, and `initialize`, `create_task` and `get_context` succeeded.
  - The log contained no task text or tokens.
- **Frontend:**
  - 257 vitest tests pass, including 8 new ones. A 404 from an older backend hides the section instead of showing an error, so a frontend that deploys first stays clean.
  - `eslint` is clean, `tsc -b` passes, and `vite build` succeeds.
  - The fallow health gate was already failing before this change (16 over threshold) and still reports 16.

## Not verified

- Whether Meta Muse sends the bearer header to a custom connector. This is the production gate: connect Muse with a read-only token before relying on writes.
- That the production `resource_metadata` URL is https. It comes from `MCP_PUBLIC_URL`, so it should be.
- The Settings section in a real browser. It is covered by component tests only.

## Deploying

Follow "Revision 0020 (MCP Agent Access)" in `docs/backend-database-migration-runbook.md`: add the Railway variables with the flag off, merge, verify the migration, flip `MCP_SERVER_ENABLED=true`, run the smoke checks, then connect the MCP Inspector and Muse.
