# Desktop Mission Control Build Plan

## Summary

Build Gust's desktop experience under `/desktop` as a protected mission-control workspace while keeping the mobile capture-first app unchanged at `/`.

The first implementation reuses the current React Router, TanStack Query, Tailwind token system, backend session model, task/group APIs, and optimistic task mutation helpers. Analytics are derived client-side from existing task endpoints until volume or pagination makes a dedicated backend analytics endpoint necessary.

## Phase 1: Route Foundation

- Replace the desktop placeholder with a dedicated `DesktopShell` mounted at `/desktop`.
- Add nested desktop routes:
  - `/desktop`
  - `/desktop/tasks`
  - `/desktop/completed`
  - `/desktop/groups`
  - `/desktop/groups/:groupId`
  - `/desktop/tasks/:taskId`
- Keep `/`, `/tasks`, `/tasks/completed`, and `/tasks/groups` mobile-oriented.
- Keep desktop access explicit rather than auto-redirecting large screens.

## Phase 2: Shared Data Layer

- Fetch open all-tasks, completed all-tasks, group-scoped open tasks, group-scoped completed tasks, and groups through existing backend endpoints.
- Add desktop derivation helpers for:
  - weekly board columns
  - upcoming tasks
  - recently completed tasks
  - completion trend for the last seven days
  - group-level open/completed/due-this-week counts
  - search, filter, and sort logic
- Expose `created_at` and `updated_at` on task summaries because task records already store them and desktop tables need created-date sorting.

## Phase 3: Dashboard

- Build `/desktop` as the desktop landing dashboard.
- Include:
  - weekly Kanban board
  - upcoming tasks
  - recently completed tasks
  - completion trend
  - group health panel
  - top-level metrics for open, overdue, due today, due this week, review-needed, and completed tasks
- Support dashboard task actions:
  - complete task
  - restore completed task
  - move task to another due date
  - open task detail

## Phase 4: Tables

- Build `/desktop/tasks` as a desktop table/list hybrid for all open tasks.
- Build `/desktop/completed` as a completed-history table.
- Persist table state in URL search params.
- Support:
  - search by title, description, or group
  - filters for group, due bucket, date range, review state, recurrence, and subtasks
  - sorting by title, group, due date, created date, completed date, review state, and recurrence
  - complete and restore actions
  - due-date editing for open tasks
- Preserve duplicate suppression for historical completed recurring rows.

## Phase 5: Groups

- Build `/desktop/groups` for group administration:
  - create group
  - edit group name and description
  - protect system Inbox
  - delete custom groups only after choosing a destination group
- Build `/desktop/groups/:groupId` for group workspaces:
  - group overview
  - group weekly board
  - group open task table
  - group completed task table
  - links to group configuration and task detail

## Phase 6: Backend Enhancements

No schema changes are required for the initial desktop release.

Optional backend additions are deferred until data volume proves they are needed:

- server-side search
- server-side due-date range filters
- server-side review filters
- server-side sort options
- user-scoped analytics summary endpoint

Any future backend read must stay explicitly user-scoped, and unsafe methods must remain CSRF and same-origin protected.

## Phase 7: Polish and Regression Safety

- Add loading, empty, and error states to every desktop page.
- Keep authenticated task responses out of service-worker caching.
- Keep motion restrained to transform/opacity transitions.
- Add frontend coverage for desktop routing, dashboard rendering, table filters, completed restore paths, and group safeguards.
- Update build-plan, decision-log, and task-output docs because this is a major product/navigation addition.

## Acceptance Criteria

- `/desktop` loads a protected dashboard for signed-in users.
- Signed-out desktop routes redirect to `/login?next=...`.
- The mobile launch route remains capture-first.
- Desktop navigation exposes Dashboard, All Tasks, Completed, Groups, and dynamic group links.
- Dashboard metrics and weekly board are derived from authenticated task data.
- Open and completed desktop task tables support search, filters, sorting, and task actions.
- Group configuration preserves Inbox protections and requires a delete destination for custom groups.
- The frontend build and focused regression tests pass.
