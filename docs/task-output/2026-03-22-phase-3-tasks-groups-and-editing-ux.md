# Task Output

## Task

Implement Phase 3: Tasks, Groups, and Editing UX.

## What Changed

- Replaced the placeholder task and group backend with authenticated CRUD, lifecycle, and nested subtask endpoints backed by dedicated task/group service layers that enforce user scoping, Inbox protections, review clearing, due-bucket sorting, reminder syncing, and recurrence `series_id` maintenance.
- Expanded the repository layer and shared task-normalization rules so task editing and capture-created tasks use the same reminder and recurrence validation path.
- Rebuilt the frontend Tasks area around authenticated data loading, group selection in URL state, bucketed `Overdue` / `Due Soon` / `No Date` sections, review indicators, and undo-backed complete/delete actions.
- Added full-screen task detail editing for title, group, due date, reminder, recurrence, and inline subtask management, with explicit save semantics and dependent clearing when `due_date` is removed.
- Added a full-screen Tasks-adjacent group management route with create, rename, description editing, delete-with-destination reassignment, and visible Inbox locks.
- Added backend tests for auth, CSRF, user scoping, sorting, group deletion reassignment, reminder lifecycle behavior, recurrence `series_id` handling, subtask CRUD, and task lifecycle transitions, plus frontend tests for auth gating, group URL state, task list rendering, undo flows, detail editing, and Inbox protections.

## Validation

- `cd backend && .venv/bin/ruff check app tests`
- `cd backend && .venv/bin/pytest -q`
- `cd frontend && npm run lint`
- `cd frontend && npm test`
- `cd frontend && npm run build`

## Follow-Up Needed

- Phase 4 still needs the reminder worker and reminder delivery path to consume the synced reminder rows created and cancelled by Phase 3.
- Phase 4 still owns recurrence generation on task completion; Phase 3 only maintains recurrence metadata on the current occurrence.
