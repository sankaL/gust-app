# Pushover Notifications and Functional Reminders

Completed 2026-08-15.

- Added notification preferences, encrypted Pushover credentials, settings APIs and mobile/desktop Settings routes.
- Added date-only and exact-time task reminder data, transactional worker processing, bounded retry state, and channel-specific digest dispatches.
- Added Railway five-minute task reminder cron and DST-safe digest candidate schedules.
- Verified backend lint plus focused regression tests and a production frontend build.

Deployment still requires the real backend-only Pushover application token, subscription URL, Fernet key, and Railway service variables before the global flag is enabled.
