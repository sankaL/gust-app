# Task Output: Security Audit and Hardening

## Date and Scope

- Date: 2026-07-14
- Branch: `codex/security-hardening`
- Scope: backend authorization/RLS, API abuse controls, browser API configuration, auth/session boundaries, deployment dependencies, Fallow analysis, dependency audits, tests, and rollout documentation
- Production deployment was not performed.

## Executive Result

The audit found and fixed several material defense-in-depth gaps without changing the intended product flows. The most important change is Alembic revision `0016_harden_rls_relationships`, which retains explicit backend `user_id` scoping while making Postgres reject cross-user parent relationships. Request throttling now runs an IP phase before auth/provider work and a user phase after local token or refresh-session resolution. Dependency audits now report zero known vulnerabilities in both frontend and Python environments.

Fallow 3.5.0's security surface moved from one medium candidate to zero verified candidates. A follow-up remediation cleared all dead code, removed every substantive clone at or above 80 tokens and 10 lines, and extracted the highest-risk shared logic. Fallow's original strict thresholds remain in force; the residual small clones and legacy JSX complexity are reported below rather than hidden by relaxed configuration.

## Identified and Fixed

| Area | Identified risk | Resolution |
|---|---|---|
| RLS relationship integrity | Existing policies checked only a row's `user_id`; an application bug could create a user-owned row referencing another user's group, capture, or task. | Revision 0016 recreates enabled/forced actor policies with parent-ownership checks for tasks, subtasks, reminders, and staged extracted tasks. |
| RLS rollout safety | Tightened policies could hide a historical cross-owner row after cutover, and a concurrent old-policy writer could race a preflight query. | The migration takes a bounded fixed-order write lock, then fails closed on any cross-owner relationship before replacing policies. The runbook includes privileged preflight queries. |
| Migration lock exposure | Four immediately validated checks could hold stronger locks while scanning `rate_limit_counters`. | Constraints are added `NOT VALID`, then validated under PostgreSQL's weaker validation lock, with a five-second lock timeout. |
| Counter integrity | Operational counter keys/counts/windows were not constrained. | Added bounded key lengths, nonnegative counts, and valid-window checks while preserving the intentional `action_lock:*` zero-window sentinel. |
| Pre-auth abuse | Token/JWKS/refresh work could happen before general throttling; unauthenticated mutations and internal jobs had no dedicated limit. | Added a pre-auth IP gate, dedicated unauthenticated-write/internal-job policies, and kept stricter capture/auth policies. |
| Refresh-session bypass | The first hardening pass omitted refresh-only sessions from account-keyed limits. | Independent review caught this. Refresh resolution now happens only after the IP gate, is cached for the auth dependency, and then receives the user rate limit. |
| Duplicate limiter cleanup | Authenticated requests initially ran expired-counter cleanup in both IP and user phases. | Cleanup now runs only in the IP phase. |
| Liveness coupling | `/health` inherited the database-backed public GET limiter, so a database incident could make deploy liveness checks fail. | The cheap liveness endpoint is explicitly excluded from database-backed throttling. |
| Proxy identity | Socket-peer-only keys collapse Railway traffic onto the proxy; trusting arbitrary forwarding headers permits spoofing. | Railway runtime uses only a syntactically valid platform `X-Real-IP`; other environments use the socket peer and ignore `X-Forwarded-For`. |
| Trusted hosts | Railway presence previously added a universal `*` trusted host. | Replaced it with Railway's bounded internal/public wildcard domains plus configured exact hosts. |
| Internal shared secret | Normal string equality exposed avoidable timing variation. | Switched to `secrets.compare_digest`. |
| Request IDs | Arbitrary unbounded `X-Request-ID` values could enter headers/log context. | Accept only a 128-character safe alphabet; otherwise generate a UUID. |
| OAuth callback input | Callback authorization codes were unbounded, and unused custom OAuth-state helpers contradicted the deployed Supabase flow. | Bounded the code query and removed dead custom-state helpers. The short-lived, high-entropy PKCE verifier cookie remains the callback binding. |
| Browser API target | Fallow reported the browser `fetch` target as a medium SSRF candidate. | API origins must now be absolute HTTPS origins (loopback HTTP only for local/dev inference), cannot include credentials/path/query/fragment, and request paths cannot escape the configured origin. The verified sink is narrowly suppressed. |
| Frontend dependencies | Baseline `npm audit` reported 16 vulnerabilities, including 1 critical and 9 high. | Updated the lockfile within declared dependency ranges; final audit reports zero. |
| Python dependencies | The Python 3.9 environment reported 42 vulnerabilities across 16 packages, while secure current releases no longer support that runtime. | Standardized on Python 3.12, raised secure dependency floors, committed `uv.lock`, and made Railway install the frozen production environment. Final `pip-audit` reports zero known vulnerabilities. |
| Recorder terminal cleanup | Independent review found constructor, start, or recorder-error paths could leave an acquired microphone stream active. | Added idempotent stream cleanup for constructor/start/error/normal-stop paths plus three lifecycle regression tests. |
| Optimistic desktop cache races | Shared status transitions updated desktop caches without first cancelling in-flight desktop task queries. | Both status-mutation paths now cancel `['desktop', 'tasks']` before snapshot/write, with a regression assertion. |
| Missing-CSRF bulk actions | Approve/discard-all silently returned when session CSRF state was absent. | Centralized fail-closed CSRF enforcement now throws the sanitized session error through the existing notification path. |
| Scanner integrity | The first remediation configuration relaxed duplication/CRAP thresholds and could overstate the result as zero backlog. | Restored Fallow defaults, removed broad overrides, regenerated strict reports, and explicitly deferred the remaining low-granularity clones and legacy JSX complexity. |

## Fallow Results

Raw reports are stored under `docs/engineering/`.

| Surface | Baseline | Security pass | Remediated |
|---|---:|---:|---:|
| Security candidates | 1 medium (`frontend/src/lib/api.ts`, dynamic browser fetch) | 0 | 0 |
| Strict audit | Not applicable | `pass` for the security-only changes | `fail` after the broader refactor because touched legacy functions retain strict complexity/clone findings |
| Dead-code issues | 12 | 12 | 0 |
| Duplicate groups at Fallow defaults | 48 | 48 | 27 |
| Duplicated lines at Fallow defaults | 1,270 | 1,270 | 585; none meet both 80 tokens and 10 lines |
| Complexity functions above Fallow defaults | 55 | 55 | 49 |
| Average maintainability | 90.6 | 90.5 | 91.0 |

The remediation deleted two unused components and five unused public API surfaces, centralized task-form validation/diffing, recurrence data, CSRF enforcement, optimistic status updates, recorder setup, route-preview state, session presentation, staging actions, and shared desktop routes. Fallow now consumes real Istanbul coverage for coverage-aware CRAP scoring. Test harness files are excluded from production complexity scoring, but production thresholds remain at Fallow's defaults. The residual duplicate groups are short presentation overlaps; the residual complexity findings are primarily legacy JSX route/modal orchestration and coverage-aware CRAP gaps.

## Validation Completed

- `make check` for the security hardening, followed by the remediation verification suite
  - frontend: 146 tests passed with Istanbul coverage enabled
  - backend: 211 tests passed after review fixes
  - frontend production build passed
  - backend/frontend lint passed with three pre-existing frontend warnings
  - backend smoke import passed
- Targeted post-review backend checks: 25 migration/security tests passed before the final full backend run.
- `npm audit --json`: 0 vulnerabilities across 725 dependencies.
- `uvx pip-audit --path backend/.venv/lib/python3.12/site-packages`: no known vulnerabilities; only the local `gust-backend` project is not a PyPI-auditable package.
- Fallow 3.5.0 combined, security, and strict audit scans completed; final results are zero dead-code issues, 27 short duplicate groups, 49 strict complexity findings, zero security candidates, and a strict audit verdict of `fail`. The raw reports preserve those residual findings.
- Ephemeral PostgreSQL validation with a non-`BYPASSRLS` runtime role passed: Alembic 0016 applied, all four counter constraints validated, the production RLS verifier passed, a same-owner relationship succeeded, a cross-owner task insert was rejected by RLS, and the zero-window action-lock sentinel remained valid.
- A live two-connection PostgreSQL test proved the preflight lock closes the concurrent-write race: the old-policy cross-owner writer was blocked and failed with SQLSTATE `55P03` while the migration lock was held, while the same control write succeeded immediately after lock release. A dirty 0015 database then failed the 0016 preflight as intended.

## Deferred

- Deep decomposition of the 49 remaining strict complexity findings is deferred. The highest-value domain logic and shared security-sensitive paths were extracted, but fully splitting the remaining legacy JSX route/modal orchestration would be a broad UI rewrite with disproportionate regression risk in this security branch.
- Fallow's 27 remaining duplicate groups are deferred after review: all are below either 80 tokens or 10 lines and are predominantly short icon, loading-state, field-row, or optimistic-cache presentation variants. The raw default-threshold report remains committed so this debt is visible.
- Three existing frontend lint warnings, a large Vite bundle warning, and framework deprecation warnings remain. They are not security blockers for this change.
- A local Railway Docker build was attempted but cancelled when Docker Hub base-image metadata did not return; the same frozen Python 3.12 dependency set was installed and fully tested through `uv` locally.
- Application rate limiting still consumes a database write and is not a substitute for an edge WAF or volumetric DDoS protection.
- RLS protects against application query/scoping mistakes, not compromise of the runtime database credential. The current internal-job path is a caller-set transaction GUC; a holder capable of arbitrary SQL with that credential can set it too.
- Fallow reported 668 unresolved callee sites in its final security graph. It reported zero unresolved edge files, but the call-graph blind spots should be kept in mind when adding dynamic runtime loading.

## Needs User Input or Operational Action

1. Approve and schedule production rollout of migration 0016. Before deploying, run the relationship/counter preflight queries in the migration runbook with `MIGRATION_DATABASE_URL`; every violation count must be zero.
2. Decide whether to add edge protection (for example, Cloudflare/WAF/edge rate limits) in front of Railway. The application limits protect expensive work but cannot absorb volumetric traffic by themselves.
3. Decide whether internal jobs should receive a separate database role/connection. That would remove the residual risk of a general runtime credential being able to set the internal-job GUC.
4. After deployment, run `scripts/prod/check-postgres-rls.py` with the least-privilege runtime URL and execute two-user same-owner/cross-owner smoke tests plus daily/weekly internal-job checks.

## Confidence

Confidence is 97%. Production confidence would increase after the privileged preflight returns zero on production-sized data, migration 0016 is exercised against a staging clone representative of production load, and the post-deploy runtime-role/two-user verification passes. Refactor confidence would increase further with browser end-to-end coverage of desktop task status transitions and task-detail editing.
