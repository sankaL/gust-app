# 2026-03-28 Performance Loading And Cache Consistency

## Summary

Implemented the first production performance pass across both frontend and backend so task/capture flows keep visible data on screen, route transitions feel faster, and the API now exposes timing data for real production diagnosis.

## What Changed

- Backend:
  - Reworked [`backend/app/db/engine.py`](../../backend/app/db/engine.py) to reuse process-level SQLAlchemy engines instead of constructing and disposing an engine per request.
  - Added request timing context and `Server-Timing` headers through:
    - [`backend/app/core/timing.py`](../../backend/app/core/timing.py)
    - [`backend/app/core/middleware.py`](../../backend/app/core/middleware.py)
  - Added timed hot-path spans in session resolution, task list/detail reads, capture transcription/extraction/staging, and staging approve/discard flows.
  - Replaced the `list_groups_with_recent_tasks` N+1 pattern in [`backend/app/db/repositories.py`](../../backend/app/db/repositories.py) with a single ranked query.
  - Batched `approve_all` work for extracted tasks inside one DB scope in [`backend/app/services/staging.py`](../../backend/app/services/staging.py).

- Frontend:
  - Strengthened TanStack Query defaults in [`frontend/src/providers.tsx`](../../frontend/src/providers.tsx) to keep prior data visible during refetch and avoid unnecessary cold reloads.
  - Added shared task cache helpers in [`frontend/src/lib/taskQueryCache.ts`](../../frontend/src/lib/taskQueryCache.ts) for:
    - optimistic task/subtask updates
    - rollback snapshots
    - group open-count adjustments
    - task-detail cache synchronization
  - Fixed the active capture review flash in:
    - [`frontend/src/components/StagingTable.tsx`](../../frontend/src/components/StagingTable.tsx)
    - [`frontend/src/routes/CaptureRoute.tsx`](../../frontend/src/routes/CaptureRoute.tsx)
  - Seeded task detail from cached list data and reduced full-screen blocking states in [`frontend/src/routes/TaskDetailRoute.tsx`](../../frontend/src/routes/TaskDetailRoute.tsx).
  - Added task-detail prefetch hooks from task cards through:
    - [`frontend/src/components/OpenTaskCard.tsx`](../../frontend/src/components/OpenTaskCard.tsx)
    - [`frontend/src/routes/TasksRoute.tsx`](../../frontend/src/routes/TasksRoute.tsx)
  - Replaced route-wide task busy states with per-task/per-subtask pending state in:
    - [`frontend/src/routes/TasksRoute.tsx`](../../frontend/src/routes/TasksRoute.tsx)
    - [`frontend/src/routes/CompletedTasksRoute.tsx`](../../frontend/src/routes/CompletedTasksRoute.tsx)
    - [`frontend/src/routes/TaskDetailRoute.tsx`](../../frontend/src/routes/TaskDetailRoute.tsx)
  - Migrated the all-tasks surface to query-backed infinite pagination in [`frontend/src/components/AllTasksView.tsx`](../../frontend/src/components/AllTasksView.tsx).

## Regression Coverage

- Frontend:
  - Added capture coverage for “loading instead of empty-state flash” in [`frontend/src/test/capture.test.tsx`](../../frontend/src/test/capture.test.tsx).
  - Kept all existing capture/task/app regressions green.

- Backend:
  - Added engine reuse coverage and ranked recent-task query coverage in [`backend/tests/test_repositories.py`](../../backend/tests/test_repositories.py).
  - Added `Server-Timing` response coverage in [`backend/tests/test_tasks_groups.py`](../../backend/tests/test_tasks_groups.py).

## Verification

- `npm test` in [`frontend/`](../../frontend)
- `python3 -m pytest backend/tests/test_repositories.py backend/tests/test_tasks_groups.py backend/tests/test_captures.py`
