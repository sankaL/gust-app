# Task Output: Security Hardening Rate Limits and Input Safety

## Date
- 2026-03-28

## Summary
- Added a new Alembic revision, `0011_rate_limit_counters`, and backend-owned fixed-window rate limiting for auth, capture, and general API routes.
- Hardened request handling with typed text/audio validation, per-user capture locks, OAuth `state` validation, same-origin enforcement for unsafe cookie-authenticated methods, trusted hosts, and security headers.
- Reduced sensitive logging exposure by removing transcript/provider payload logging, sanitizing user-controlled log fields, and limiting provider failure logs to redacted metadata.
- Added frontend hardening through a restrictive app-shell CSP and regression coverage that blocks accidental provider-secret env access from browser code.

## Implemented Behavior
- Abuse protection:
  - Postgres-backed counters keyed by `scope`, `subject_key`, `window_start`, and `window_seconds`
  - `429 rate_limit_exceeded` responses with `Retry-After` and `X-RateLimit-Limit/Remaining/Reset`
  - stricter limits on `POST /captures/voice`, `POST /captures/text`, and `POST /captures/{id}/submit`
  - one-at-a-time per-user locking for expensive capture processing to prevent concurrent duplicate provider calls
- Input safety:
  - transcript and text capture payloads capped at 20,000 characters
  - task, group, and subtask titles capped at 200 characters
  - task descriptions capped at 2,000 characters
  - group descriptions capped at 500 characters
  - NUL and other non-printable control characters rejected except for `\n`, `\r`, and `\t`
  - voice uploads capped at 10 MiB with an allowlist of supported audio MIME types
- Auth/request hardening:
  - backend OAuth state cookie generated on Google start and validated on callback
  - unsafe cookie-authenticated methods require both CSRF token validation and same-origin `Origin`/`Referer`
  - trusted-host middleware and conservative API security headers enabled
- Prompt/logging hardening:
  - transcript prompt sanitization now neutralizes delimiters/control sequences instead of broad natural-language regex rewriting
  - extraction prompts explicitly treat transcript content as untrusted data
  - provider response bodies, transcript blobs, and raw filenames are no longer logged

## Validation Scope
- Backend targeted suite:
  - `tests/test_auth_session.py`
  - `tests/test_security_hardening.py`
  - `tests/test_captures.py`
  - `tests/test_tasks_groups.py`
  - result: `83 passed`
- Frontend targeted suite:
  - `src/test/capture.test.tsx`
  - `src/test/security-config.test.ts`
  - result: passed before final backend doc/bookkeeping updates

## Notes
- The backend now treats throttling as part of the public API contract, so clients should handle `rate_limit_exceeded` explicitly.
- Bot resistance remains intentionally low-friction in this patch: auth allowlisting, CSRF, same-origin checks, rate limiting, and request locking are preferred over CAPTCHA.
- Full production confidence still depends on validating the configured trusted hosts/origins and any desired limit overrides against real Railway traffic patterns.
