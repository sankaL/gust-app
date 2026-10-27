# App Snappiness Performance Plan

**Created:** 2026-10-27 09:30 EDT
**Updated:** 2026-10-27 09:55 EDT. Merged findings from a second, independent audit: edge-measured timings, cold connections, the reminder job blocking the event loop, refetches after Complete, Railway CDN and cost data, and the option of calling Anthropic directly.
**Status:** In progress (build plan row ADH-88). Phase 0 and the Phase 1 quick wins (items 1, 2, 7 and 8) were implemented on 2026-10-27 and are not yet deployed; see Progress.
**Scope:** Frontend load and interactions, backend request path, capture/AI calls, Railway and Supabase infrastructure

## Goal

Make Gust feel instant while keeping Railway and Supabase cost the same or lower.

Target, stated honestly:

- **Server time for reads and writes:** under 30 ms at p50. Reachable after Phases 1 and 2.
- **Taps:** feel instant (under 100 ms) everywhere, by updating the screen before the server replies. Task actions already do this; capture review does not.
- **Network:** the phone-to-Railway round trip (roughly 20-80 ms, Toronto to Virginia) is physics and stays.
- **Capture:** stays in seconds, because transcription and the model call take time. The goal is about 2.5 s end to end for a 20-second clip, with the transcript visible at about 1.2 s if results stream.
- **Cold launch with tasks on screen in under 100 ms:** only possible if last-known tasks are kept on the device. That conflicts with the current rule against caching task data (see Decisions).

## Baseline (production, 2026-10-26 to 2026-10-27)

Source: Railway backend logs for deployment `0a8c764d`, `request_completed` events, timing fields only. Small sample: one day, 7 task-list loads, 1 voice capture.

| Request | n | p50 | p90 | Logged stages |
|---|---|---|---|---|
| `GET /auth/session` | 8 | 145 ms | 186 ms | `auth.session.resolve` ~144 ms |
| `GET /tasks` | 7 | 318 ms | 607 ms | `auth.session.resolve` ~122 ms, `db.tasks.list` ~137 ms |
| `GET /captures/pending-tasks` | 6 | 532 ms | 660 ms | `auth.session.resolve` ~125 ms, `db.staging.list` ~93 ms |
| `GET /groups` | 5 | 627 ms | 913 ms | `auth.session.resolve` ~136 ms |
| `POST /captures/voice` | 1 | 4,337 ms | | context 291, transcription 1,344, extraction 2,339, staging 190 |

What else the logs show:

- **The voice capture:** an iOS `audio/mp4` upload of 879,075 bytes for a 280-character transcript (roughly 20 seconds of speech).
- **Its extraction call:** `cache_read_input_tokens=0`, `cache_creation_input_tokens=3339`. The prompt cache missed.
- **Launch requests:** app-log timestamps for one launch are identical because Railway ingests them in a batch, so they cannot show order. Use the edge logs below for that.
- **Bot traffic:** scanner probes (`/.env`, `/wp-*`, and similar) hit the API daily. Some of these 404s take 0.5-1 s, which only happens when the event loop is blocked by other work.
- **Undercounting:** the logged numbers are too low. `duration_ms` and `request.total` start after the middleware's IP and user rate-limit writes and token validation.

### Edge-measured baseline (true server time)

Source: Railway edge HTTP logs (`railway logs -s backend --http --json -n 3000 --since 3d`), field `totalDuration`. These include everything the app logs leave out. Query strings are stripped, and `clientUa` shows the device. The edge `timestamp` appears to be the response end time: a `GET /tasks/:id` edge entry landed 14 ms before its app log line.

| Request | n | Edge p50 | Edge p90 | App-logged p50 |
|---|---|---|---|---|
| `GET /auth/session` | 8 | 1,085 ms | 2,448 ms | 145 ms |
| `GET /groups` | 5 | 1,093 ms | 1,234 ms | 627 ms |
| `GET /captures/pending-tasks` | 6 | 913 ms | 1,005 ms | 532 ms |
| `GET /tasks` | 7 | 523 ms | 1,092 ms | 318 ms |
| `GET /tasks/:id` | 1 | 472 ms | | 292 ms |
| `POST /captures/voice` | 1 | 4,614 ms | | 4,337 ms |
| `POST /internal/reminders/run` | 276 | 588 ms | 692 ms | ~316 ms |

- **Slow sessions are launches after idle.** The two fast `GET /auth/session` calls (~100 ms) came minutes after a deploy. The slow ones are app launches after hours idle.
- **The launch is a chain on the iPhone.** On both iPhone launches in the logs, `/auth/session` finishes first. `/captures/pending-tasks` and `/groups` start together about 0.4 s later. `/tasks` starts 0.8-1.9 s after `/groups` finishes. From the first request to the task list arriving took about 4-5 s.
- **The `/groups` to `/tasks` gap is unexplained.** In the code, both queries fire when `TasksRoute` mounts, so the cause needs a Safari Web Inspector trace. Production runs `main` (`25bff29`), and the mobile revamp branch's launch code differs, so re-measure after the revamp ships.
- **Network floor.** Warm, kept-alive `GET /health` from Toronto takes 33-70 ms end to end, against 0.5 ms of server time. Requests enter Railway's edge in Toronto (`x-railway-edge: yyz1`) and travel to us-east4.

## Infrastructure Facts

- All Railway services (backend, frontend, `digest-daily-cron`, `digest-weekly-cron`, `task-reminder-cron`) run in **us-east4 (Virginia)**, one replica each.
- The Supabase project is in **ca-central-1 (Montreal)**. The backend's `DATABASE_URL` uses the Supavisor session pooler (`aws-1-ca-central-1.pooler.supabase.com:5432`).
- Railway has no Canadian region.
- `auth.session.resolve` takes about 125 ms for about 8 DB round trips, so **each round trip costs about 16 ms**.
- The frontend is served by the Node `serve` package on Railway without long-lived cache headers. The service worker precaches the app shell (71 entries, about 1.2 MB).
- The entry JS bundle is 411 KB (129 KB gzip). `react-dom` and `react-router` are most of it.
- DNS for `gustapp.ca` is on Cloudflare. Hashed assets come back with `cache-control: max-age=14400` (4 hours) and `cf-cache-status: MISS`, and Railway's own CDN is disabled for both services (`railway cdn status -s frontend`).
- Railway cost for `gust-prod`: $1.17 in the first 18 days of the Oct 9 - Nov 9 billing period, about $2 a month. Nearly all of it is memory: backend about 150 MB, frontend `serve` about 40 MB, crons near zero. The workspace bill (about $13 a month) also covers other projects.
- Stale backend variables can be removed: `ASSEMBLYAI_API_KEY` and `OPENROUTER_EXTRACTION_MODEL` (the code no longer reads either).

## Root Causes (largest first)

### 1. Too many cross-region DB round trips per request

An authenticated GET makes about 25 round trips, each in its own transaction with a `pool_pre_ping` check ([engine.py:32](../../backend/app/db/engine.py:32)):

| Step | Work | Round trips |
|---|---|---|
| IP rate limit ([rate_limits.py:108](../../backend/app/core/rate_limits.py:108)) | `SELECT` expired counters plus `DELETE` on every request, then per window an `INSERT ... ON CONFLICT` and a separate `SELECT` to read the count back ([repositories.py:2126](../../backend/app/db/repositories.py:2126), [repositories.py:2168](../../backend/app/db/repositories.py:2168)) | 5-6 |
| User rate limit | The same pattern again in a second transaction | 4-5 |
| Session resolve ([dependencies.py:184](../../backend/app/core/dependencies.py:184)) | Two separate `set_config` calls, allowlist lookup, user row, Inbox row ([repositories.py:531](../../backend/app/db/repositories.py:531), [repositories.py:751](../../backend/app/db/repositories.py:751)) | ~8 |
| Route queries | Two more `set_config` calls, then the route's queries; the task list is followed by a separate subtask-count query ([repositories.py:1090](../../backend/app/db/repositories.py:1090)) | ~6-7 |

At about 16 ms per round trip, that is about 400 ms of database waiting per request.

### 2. Work that blocks the event loop

- **A JWKS fetch on every request.** `get_auth_service` ([dependencies.py:52](../../backend/app/core/dependencies.py:52)) builds a new `SupabaseAuthService` each time, and with it a new `PyJWKClient`. The empty key cache forces a blocking HTTPS fetch of Supabase's signing keys on every authenticated call. The middleware keeps its own auth service, so its key cache does persist.
- **Blocking DB calls in async code:**
  - `RequestContextMiddleware.dispatch` ([middleware.py:31](../../backend/app/core/middleware.py:31)) runs the rate-limit transactions synchronously inside async code.
  - The async `get_optional_session_context` ([dependencies.py:136](../../backend/app/core/dependencies.py:136)) runs its session query synchronously.
  - Every `async def` capture and staging route does too, for example [staging.py:84](../../backend/app/services/staging.py:84) and [staging.py:700](../../backend/app/services/staging.py:700).
  - So do the capture action lock acquire and release ([action_locks.py:23](../../backend/app/core/action_locks.py:23)).
  - So does the reminder job: the `async def` route `run_due_reminders` ([reminders.py:28](../../backend/app/api/routes/reminders.py:28)) runs the worker's synchronous DB work on the loop. The task cron calls it every 5 minutes for about 0.6 s at the edge, so any request that lands in that window waits.
- **The result:** requests that arrive together are served one after another. This is why `/groups` and `/captures/pending-tasks` take 500-900 ms at launch.

### 2b. Cold connections after a few idle minutes

- **DB connections.** `pool_recycle=300` ([engine.py:32](../../backend/app/db/engine.py:32)) retires every connection after 5 minutes. A launch after a short idle then rebuilds TCP, TLS and Postgres login to the Montreal pooler, several round trips each, once per concurrent request.
- **Supabase auth calls.** Login, refresh and logout open a new `httpx.AsyncClient` for every call ([auth.py](../../backend/app/services/auth.py)). The first launch after the 1-hour access token expires pays a fresh TLS handshake plus the refresh.
- **Extraction client.** The `anthropic` SDK client is shared, but its HTTP pool probably uses httpx's default 5-second keep-alive, so sparse captures likely reconnect each time. The Phase 5 warm-up covers this.

### 3. Capture review waits for the server

Approve and discard in the review sheets wait for the POST, then for three refetches (`pending-tasks`, `tasks`, `extracted-tasks`), before the card leaves ([useCaptureController.ts:101](../../frontend/src/routes/capture/useCaptureController.ts:101)). That is about 1 s per tap. Approve-all across several captures sends one request per capture.

### 4. Capture pipeline overhead

- **Audio bitrate:** [microphone.ts:43](../../frontend/src/lib/microphone.ts:43) creates `MediaRecorder` with no `audioBitsPerSecond`, so iOS records at roughly 350 kbps. Speech recognition needs about 32 kbps mono.
- **Prompt cache:** the static extraction prompt is cached with the default 5-minute lifetime ([extraction.py:178](../../backend/app/services/extraction.py:178)). Captures are usually more than 5 minutes apart, so each capture pays the cache write and 0.4-0.8 s of extra latency.
- **Schema compile:** the first request of the day for the output schema also pays a 9-11 s grammar compile.
- **Capture lock:** acquire and release are separate transactions of several round trips each.
- **Staging writes:** they run after extraction, on the critical path (190 ms).

### 5. Launch waterfall and font loading

- **Steps that wait on each other:** HTML and entry JS, then the session check, then the lazy `AppShell` chunk, then the timezone gate, then the lazy `TasksRoute` chunk, and only then the task, group and pending queries.
- **Render-blocking fonts:** [styles.css:1](../../frontend/src/styles.css:1) loads Inter and Manrope through a render-blocking `@import` from `fonts.googleapis.com`, which then pulls files from `fonts.gstatic.com`. That is two extra origins before first paint, and the service worker does not cache them.

## Progress

**2026-10-27 11:38 EDT: Phase 0 and the Phase 1 quick wins, implemented and tested, not yet committed or deployed.**

- **Phase 0, timing.** The middleware starts its timer when the request arrives. `Server-Timing` and the `request_completed` log now include `ratelimit.ip`, `auth.token`, `auth.refresh` and `ratelimit.user`. Rate-limited `429` responses also carry timing and `X-Request-ID`, and are logged.
- **Item 1, one auth service per process.** `create_app` builds one auth service, and the middleware and `get_auth_service` share it, so the JWKS client and its 5-minute key cache persist. Token validation runs in the worker threadpool.
- **Item 2, event loop.** Blocking work now goes through the shared threadpool helper (`app/core/concurrency.py`):
  - the middleware's rate-limit writes, and the session dependency's lookup
  - the staging service's database methods
  - the capture service's lock, failure marking, submit and complete
  - the async auth and notification routes
  
  Still to do: replacing `BaseHTTPMiddleware` with a plain ASGI middleware.
- **Item 7, warm connections.** `pool_recycle` went from 5 to 30 minutes, Postgres connections use TCP keepalives, and Supabase auth calls share one `httpx.AsyncClient` opened in the app lifespan.
- **Item 8, reminder job.** The internal reminder route runs the worker on its own event loop in a worker thread.
- **Tests.** There are 15 new tests. On the old code, the new request-path tests fail: an unrelated `/health` call waited the full 1 s behind a blocked request, and the signing-key client was built 4 times for 3 requests. The full backend suite passes (287 tests).
- **Not yet measured in production.** After deploying, compare Railway edge `totalDuration` and the new `Server-Timing` stages with the baseline above.
- **Watch after deploy.** Requests now reach the database concurrently instead of one at a time. Keep the SQLAlchemy pool (5 plus 10 overflow) within the Supavisor session-pool limit, and look for pooler connection errors in the logs.

## Plan

Each phase can ship on its own. Phases 1, 3, 4 and 5 are code-only. Phase 2 is the infrastructure move.

### Phase 0: Measure properly (small, do first) *(code done 2026-10-27; Safari trace and post-deploy baseline still to do)*

- Start the request timer at the top of `RequestContextMiddleware.dispatch`.
- Add `Server-Timing` stages for `ratelimit.ip`, `ratelimit.user` and `auth.token`.
- Record a new baseline over a few days before and after each phase. Read it with the jq recipe in the prod-timing notes (timing fields only, no user IDs).
- Use the edge HTTP logs (`totalDuration`) as the scoreboard. They already include the middleware.
- Record one Safari Web Inspector timeline of a cold launch of the installed iPhone app, to explain the `/groups` to `/tasks` gap.
- **Verification:** `Server-Timing` on `GET /tasks` shows the pre-route stages, and `request.total` grows by about the rate-limit time.

### Phase 1: Backend request path (no cost change)

1. **Process-wide auth service.** *(Done 2026-10-27.)* Build the auth service once per process, or cache it with `lru_cache` keyed on settings, so the JWKS key set is fetched about every 5 minutes instead of on every request. Also move the occasional refresh off the event loop.
2. **Stop blocking the event loop.** *(Done 2026-10-27, except the ASGI middleware replacement.)*
   - Run synchronous DB work in the middleware and the session dependency through the threadpool, or make those parts synchronous dependencies.
   - Make the capture and staging routes offload DB calls the same way the voice path already does with `asyncio.to_thread`.
   - Replace `BaseHTTPMiddleware` with a plain ASGI middleware.
   - Keep the SQLAlchemy pool size at or below the Supavisor pool limit.
3. **Rate limiting in one statement.**
   - Evaluate the IP and user windows in one multi-row `INSERT ... ON CONFLICT DO UPDATE ... RETURNING request_count`, in autocommit, after local token validation.
   - Move expired-counter cleanup to the existing 5-minute task-reminder cron.
   - Return 404 for unknown paths before any DB work.
   - This keeps the Postgres-backed design in `docs/Tech-Stack-Gust.md`, so no contract change is needed (in-memory limits are a Decision below).
4. **One transaction per request.**
   - Resolve the session context on the same connection and transaction the route uses.
   - Set both actor settings in a single `SELECT set_config(...), set_config(...)`.
   - Fetch allowlist, user and Inbox in one query.
   - Keep the per-request allowlist check, because the docs promise that removed emails lose access on the next request.
5. **Fold subtask counts into the task-list query**, as an aggregated join or a correlated count in the same statement.
6. **`pool_pre_ping`:** keep it if Phase 2 lands (about 1 ms). Otherwise rely on `pool_recycle` plus a single reconnect on a stale connection.
7. **Keep connections warm.** *(Done 2026-10-27, plus TCP keepalives.)*
   - Raise `pool_recycle` from 300 s to about 30 minutes. The 5-minute task cron then keeps a connection alive, and `pool_pre_ping` still catches dead ones.
   - Open one shared `httpx.AsyncClient` for Supabase auth in the app lifespan, like the AI clients.
8. **Move the reminder worker off the event loop.** *(Done 2026-10-27.)* Use `asyncio.to_thread` for its DB work, or make the route synchronous.

Expected: about 25 round trips per authenticated GET down to about 6. A read drops from roughly 400 ms to roughly 100 ms server time in the current region, and launch requests no longer queue behind each other.

Docs: update `docs/Tech-Stack-Gust.md` (Abuse Controls: single-statement limiter, cleanup in cron; Database Access: per-request transaction). Add regression tests for the limiter math, the single-transaction session resolve, and the allowlist revocation.

### Phase 2: Move Supabase to us-east-1 (needs owner sign-off)

- **What:** create a new Supabase project in AWS us-east-1 (N. Virginia). It is about 1-2 ms from Railway us-east4, compared with about 16 ms to Montreal.
- **Migration outline:**
  - Dump and restore the `public` schema and data, plus the `auth` users and identities, following Supabase's project-migration guide.
  - Re-apply `supabase/migrations/` (allowlist hook and grants), the runtime least-privilege role, and RLS.
  - Run `scripts/prod/check-postgres-rls.py`.
  - Point `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `SUPABASE_URL` and the anon key at the new project.
  - Expect a short maintenance window and one forced sign-in for every user (new JWT signing keys).
- **Expected:** each remaining round trip drops from ~16 ms to ~1-2 ms, so reads reach about 15-30 ms server time. Supabase Auth calls (login, refresh) also get faster.
- **Cost:** same Supabase tier. On a paid plan, two projects overlap for the migration window, then the old one is deleted.
- **Docs:** `docs/backend-database-migration-runbook.md` (cutover and rollback), `docs/Tech-Stack-Gust.md` (topology), decision log entry.
- **If data must stay in Canada:** no Railway region is in Canada, so the alternative is moving the backend to a Canadian host. That leaves Railway and is out of scope here.

### Phase 3: App launch path

1. **Self-host fonts.** Serve Inter and Manrope as Latin-subset `woff2` from `public/`, `preload` the two weights used above the fold, and remove the `@import`. The service worker then precaches them, which removes two origins and the render-blocking chain. Narrow the CSP `font-src`/`style-src` afterwards.
2. **Start the session fetch earlier.** Move the `QueryClient` out of the component and prefetch `['session-status']` in `main.tsx`, so it races the lazy chunk downloads. Preload the `AppShell` and `TasksRoute` chunks, or import them eagerly since `/tasks` is home.
3. **Fetch launch data together.** Request open tasks, groups and pending tasks in parallel with the session, discarding them if the session says signed out. A single bootstrap endpoint is only worth adding if Phase 2 is rejected, because it adds API surface.
4. **Static caching.**
   - **Option A:** add `serve.json` headers. `/assets/*` gets `public, max-age=31536000, immutable`; `index.html`, `sw.js` and `manifest.webmanifest` get `no-cache`.
   - **Option B (Decision):** move the static frontend to Cloudflare Pages for free global CDN, brotli and HTTP/3, and delete the Railway frontend service. That is faster and cheaper (saves about $0.40 a month).
   - **Option C:** keep the Railway service and turn on Railway's CDN (`railway cdn enable -s frontend`) together with the Option A headers. Check Railway's CDN pricing first.
5. **Replace the full-screen gates** ("Session check", "Aligning your task dates") with the app skeleton, so launch looks like the app instead of a status page.

Expected: launch requests drop from about 1.2 s of chained API time to about 150-250 ms including network after Phases 1 and 2. First paint no longer waits on Google Fonts.

### Phase 4: Interaction snappiness

1. **Optimistic capture review.** On approve or discard, remove the item from `['pending-tasks']` and `['extracted-tasks', captureId]` immediately, and roll back with a toast on error. Have approve return the created task(s) and insert them into task lists with `setQueryData`. Use background invalidation (`refetchType: 'inactive'`) instead of awaiting three refetches.
2. **Targeted cache updates in task preview.** [useTaskPreviewMutations.ts](../../frontend/src/hooks/useTaskPreviewMutations.ts) already updates caches optimistically, but still invalidates every active `['tasks']` list after saves and subtask edits (lines 96, 116, 154). Switch to targeted cache writes plus inactive invalidation.
   - The same applies to Complete and Undo on task cards. After the optimistic update and `syncTaskCaches`, `refreshTaskViews` ([useOpenTaskActions.ts:118](../../frontend/src/hooks/useOpenTaskActions.ts:118)) still refetches the open, completed and all-open lists. Each refetch costs about 0.5 s of the single backend process and competes with the user's next tap.
3. **Liquid-glass performance.** Profile scrolling under the liquid-glass sheet and nav on a mid-range Android phone and an older iPhone. If frames drop, fall back to the solid surface on low-end devices or under `prefers-reduced-transparency`. Measure before changing anything.

Regression tests: optimistic removal and rollback for approve, discard and approve-all.

### Phase 5: Capture pipeline

1. **Record at speech bitrate.**
   - Pass `audioBitsPerSecond: 32000` to `MediaRecorder` and request mono audio, with echo cancellation and noise suppression on.
   - Expected: uploads about 8x smaller (about 100 KB instead of 879 KB for 20 seconds), saving roughly 0.5-1.5 s on cellular.
   - Check Voxtral accuracy on 5-10 real clips before shipping. Transcription is billed per audio minute, so cost is unchanged.
2. **Warm the extraction call when the capture sheet opens.**
   - Add a CSRF-protected, rate-limited endpoint the sheet calls on open. It sends one extraction request with the identical system prompt and output schema and `max_tokens: 1`, which also reuses the provider connections. (`max_tokens: 0` is rejected together with `output_config.format`.)
   - Mark the system prompt with `cache_control: {"type": "ephemeral", "ttl": "1h"}`, so bursts of captures within an hour hit the cache.
   - Expected: saves 0.4-0.8 s per capture and hides the first-of-day 9-11 s schema compile.
   - Cost: Haiku 5.5 input is $0.10 per million tokens, and the cached prefix is about 3.3k tokens, so a warm-up costs a fraction of a cent.
   - Verify through OpenRouter: that `ttl` passes through, that the warm call and the real call land on the same provider (provider order is pinned to Anthropic), and that `cache_read_input_tokens` is above zero on the real call.
3. **Cheaper lock and staging writes.**
   - Make the capture lock acquire and release single statements in autocommit, off the event loop.
   - Write staged tasks with one multi-row `INSERT`.
   - Expected: about 200-300 ms saved in the current region, less after Phase 2.
4. **Stream results (Decision).** Return the transcript as soon as transcription finishes, then each task as extraction produces it, via NDJSON or SSE on `POST /captures/voice`. Total time is similar, but the user sees words after about 1.2 s instead of waiting about 2.5 s for everything.
5. **Later, not now:** stream audio to a realtime transcription service while recording, so the transcript is ready at stop. This conflicts with the PRD rule to upload audio only after recording stops.
6. **Optional (Decision): call Anthropic directly for extraction.** This removes the OpenRouter hop and OpenRouter's fee on credit purchases. The cost is a second provider key and bill, and it reverses the one-OpenRouter-key decision.
7. **Warm-up cost note.** A capture that follows a warm-up does not pay extra: the cache write moves from the extraction call to the warm-up, and extraction then reads the cheaper cached copy. Only opening the sheet without capturing wastes a write.

Docs: `docs/Tech-Stack-Gust.md` (Audio Capture bitrate, Extraction latency design), a decision log entry for the warm-up and 1-hour cache lifetime, and regression tests for the warm endpoint's auth and rate limit.

## Cost Impact

| Change | Effect on cost |
|---|---|
| Phase 1 limiter and transaction changes | Fewer DB writes per request; bot probes no longer write counters |
| Phase 2 region move | Same Supabase tier; short overlap on a paid plan |
| Phase 3 Option B (Cloudflare Pages) | Removes one always-on Railway service |
| Phase 5 warm-up | A fraction of a cent per capture session |
| Phase 5 bitrate | None (transcription is billed per audio minute) |
| Everything else | None |

Not recommended: more backend replicas or workers. They add cost without fixing round trips. Keep the cron services as they are, since they bill only while running. Optionally point them at Railway private networking instead of the public backend URL.

## Decisions Needed From the Owner

1. **Database region:** is it OK for task data to live in AWS us-east-1 (Phase 2)?
2. **Frontend hosting:** Cloudflare Pages, or stay on Railway with cache headers (Phase 3.4)?
3. **Capture streaming:** stream capture results, transcript first (Phase 5.4)? This changes the capture UX.
4. **On-device task cache:** keep last-known tasks on the device for an instant cold launch? This requires relaxing the "do not cache task data" rule in `frontend/AGENTS.md` and `docs/Tech-Stack-Gust.md`, and clearing that store on logout.
5. **Rate limiting:** keep it Postgres-backed with one statement per request (recommended), or move general GET and write limits to in-memory? In-memory works with a single replica but resets on deploy.
6. **Extraction provider:** keep OpenRouter, or call Anthropic directly (Phase 5.6)?

## Expected Results

| Measure | Today | After Phase 1 | After Phases 1 + 2 |
|---|---|---|---|
| DB round trips per authenticated GET | ~25 | ~6 | ~6 |
| Server time, `GET /tasks` | ~320 ms logged (more in reality) | ~100 ms | ~15-30 ms |
| Launch API time (session plus data) | ~1-1.2 s logged; ~4-5 s at the edge on iPhone after idle | ~300 ms | ~150-250 ms incl. network |
| Review approve or discard (perceived) | ~1 s | ~1 s | Instant after Phase 4 |
| Voice capture, 20 s clip | ~4.3 s server plus upload | ~4 s | ~2.5 s after Phase 5, transcript at ~1.2 s if streamed |

## Confidence

- **Diagnosis:** about 85%. The code paths and production logs agree.
- **Projected numbers:** about 60-70%. The sample is one day, 7 task-list loads and 1 voice capture.
- **Cause of the iPhone `/groups` to `/tasks` gap:** about 50%, until the Safari trace in Phase 0.
- **What would raise confidence:**
  - Phase 0 timing collected over a week.
  - A direct timing of `SELECT 1` from inside the backend container (`railway ssh`).
  - A few real captures after the bitrate and warm-up changes.
  - Knowing the current Supabase plan.
