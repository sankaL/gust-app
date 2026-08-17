# Pushover Notifications and Functional Reminders

Completed 2026-08-15.

- Added notification preferences, encrypted Pushover credentials, settings APIs and mobile/desktop Settings routes.
- Added date-only and exact-time task reminder data, transactional worker processing, bounded retry state, and channel-specific digest dispatches.
- Added Railway five-minute task reminder cron and DST-safe digest candidate schedules.
- Verified backend lint plus focused regression tests and a production frontend build.

Deployment still requires the real backend-only Pushover application token, subscription URL, Fernet key, and Railway service variables before the global flag is enabled.

## 2026-08-17 Preview-link and formatting refinement

- Changed task reminder actions to open `/tasks?group=all&task=<id>`, reusing the established task-preview modal and its complete/edit/delete/checklist behavior.
- Preserved task-preview query state through login and device-mode mapping, including `/desktop/tasks?task=<id>` for desktop and iPad clients.
- Added dedicated task, daily, and weekly Pushover builders with preview-aligned field hierarchy, friendly dates and recurrence labels, blank-line section separation, supported HTML emphasis, user-content escaping, and complete-boundary overflow notices.
- Added fail-closed Pushover message-length validation instead of silently slicing messages and potentially breaking content or markup.
- Added backend formatter/provider/worker coverage and frontend preview-link, completion, authentication-return, and device-routing coverage.
- Verified 246 backend tests, 187 frontend tests, backend/frontend lint, backend startup smoke, and the production frontend build. The repository-wide Fallow gate still reports its pre-existing task-preview/edit-modal complexity and unused `WaveBackdropMode` findings; the new device-routing helper was refactored out of that report.
