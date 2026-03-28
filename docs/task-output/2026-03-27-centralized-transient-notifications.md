# 2026-03-27 Centralized Transient Notifications

## Summary

Implemented a shared frontend notification system so transient action feedback now uses one bottom-stacked, frosted-but-solid visual treatment instead of route-local banners, inline strips, and one-off undo bars.

## What Changed

- Added [`frontend/src/components/Notifications.tsx`](../../frontend/src/components/Notifications.tsx) with:
  - shared provider and hook
  - typed notification model (`success`, `error`, `warning`, `info`, `loading`)
  - auto-dismiss timing
  - manual dismiss
  - optional action button support for undo flows
  - fixed bottom viewport with a higher z-index than floating controls
- Mounted the notification layer in [`frontend/src/providers.tsx`](../../frontend/src/providers.tsx) so notifications persist across route transitions.
- Migrated transient task, completed-task, task-detail, group-management, capture-review, and account-menu feedback into the shared notification stack.
- Replaced the old task-list and task-detail route-local undo bars with stacked actionable notifications.
- Upgraded remaining inline workflow/form error surfaces to use stronger filled backgrounds for visibility instead of faint outline-heavy containers.

## Regression Coverage

- Added [`frontend/src/test/notifications.test.tsx`](../../frontend/src/test/notifications.test.tsx) to cover:
  - stacked notifications
  - auto-dismiss timing
  - longer-lived actionable notifications
  - manual dismiss
  - persistence across route transitions
  - high-z-index viewport rendering
- Kept task-flow regression coverage green in:
  - [`frontend/src/test/tasks.test.tsx`](../../frontend/src/test/tasks.test.tsx)
  - [`frontend/src/test/app.test.tsx`](../../frontend/src/test/app.test.tsx)

## Verification

- `npm --prefix frontend run build`
- `npm --prefix frontend run lint`
- `npm --prefix frontend run test -- src/test/tasks.test.tsx src/test/app.test.tsx src/test/notifications.test.tsx`
