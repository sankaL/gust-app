# Gust Database Schema

**Version:** 1.1  
**Last Updated:** 2026-03-22

This document is the source of truth for the Gust v1 application schema. It defines the database contract required by the product spec in [PRD-Gust.md](/Users/sankal/Documents/professional/gust-app/docs/PRD-Gust.md) and the implementation architecture in [Tech-Stack-Gust.md](/Users/sankal/Documents/professional/gust-app/docs/Tech-Stack-Gust.md).

The schema is designed to support:

- explicit per-user scoping
- a non-null Inbox group per user
- typed recurrence for v1
- idempotent reminder delivery
- bounded capture retention
- backend-owned correctness independent of implicit RLS behavior

## Global Rules

- Every user-owned row must be scoped by `user_id`.
- Application tables use UUID primary keys unless noted otherwise.
- All timestamps are stored as `TIMESTAMPTZ` in UTC.
- All relative date resolution uses the persisted user IANA timezone.
- `group_id` is never null for tasks.
- Raw audio is never persisted in the application schema.
- Reminder delivery state is normalized into a dedicated reminders table.
- Group names must be unique per user.

## Enumerations

Use PostgreSQL check constraints or named enums for the following value sets.

### `task_status`

- `open`
- `completed`

### `capture_status`

- `pending_transcription`
- `transcription_failed`
- `ready_for_review`
- `submitted`
- `extraction_failed`
- `completed`

### `reminder_status`

- `pending`
- `claimed`
- `sent`
- `cancelled`
- `failed`

### `recurrence_frequency`

- `daily`
- `weekly`
- `monthly`

## Tables

### `users`

Application user profile keyed by the Supabase auth user ID.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `uuid` | No | Primary key. Must match the Supabase auth user UUID. |
| `email` | `text` | No | Latest resolved user email for operational use. |
| `display_name` | `text` | Yes | Optional user-facing name. |
| `timezone` | `text` | No | IANA timezone, for example `America/Toronto`. |
| `created_at` | `timestamptz` | No | Default `now()`. |
| `updated_at` | `timestamptz` | No | Default `now()`. |

Constraints and invariants:

- `timezone` must store an IANA timezone identifier, validated by the backend.
- `email` should be unique if persisted for lookup, but `id` remains the only trusted identity key.
- A user row must exist before any group, task, capture, or reminder rows are created.

### `groups`

Task group container, including the required system Inbox.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `uuid` | No | Primary key. |
| `user_id` | `uuid` | No | Foreign key to `users.id`. |
| `name` | `text` | No | User-visible name. Unique per user. |
| `description` | `text` | Yes | Optional AI-routing hint. |
| `is_system` | `boolean` | No | `true` only for system-managed groups. |
| `system_key` | `text` | Yes | Reserved identifier for system groups. `inbox` for the Inbox group. |
| `created_at` | `timestamptz` | No | Default `now()`. |
| `updated_at` | `timestamptz` | No | Default `now()`. |

Constraints and invariants:

- Unique constraint on `(`user_id`, lower(name))`.
- Partial unique constraint on `(`user_id`, `system_key`)` where `system_key` is not null.
- Each user must have exactly one Inbox group with:
  - `is_system = true`
  - `system_key = 'inbox'`
- Inbox cannot be deleted or renamed in v1.

### `tasks`

Primary task record for open and completed tasks.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `uuid` | No | Primary key. |
| `user_id` | `uuid` | No | Foreign key to `users.id`. |
| `group_id` | `uuid` | No | Foreign key to `groups.id`. Never null. |
| `capture_id` | `uuid` | Yes | Foreign key to `captures.id` when task originated from a capture. |
| `series_id` | `uuid` | Yes | Stable recurrence-series identifier shared by occurrences. Null for non-recurring tasks and actively maintained when recurrence is added, edited, or removed. |
| `title` | `text` | No | Non-empty task title. |
| `status` | `task_status` | No | `open` or `completed`. |
| `needs_review` | `boolean` | No | Defaults to `false`. |
| `due_date` | `date` | Yes | Optional due date in the user's calendar context. |
| `reminder_at` | `timestamptz` | Yes | Canonical task-level reminder timestamp when the capture flow or task editing sets a reminder. |
| `reminder_offset_minutes` | `integer` | Yes | Relative offset from the due date/time for inherited recurrence reminders. |
| `recurrence_frequency` | `recurrence_frequency` | Yes | Null when not recurring. |
| `recurrence_interval` | `integer` | Yes | Reserved for v1 default `1`; must be `1` in v1. |
| `recurrence_weekday` | `smallint` | Yes | `0-6` for Sunday-Saturday. Required for weekly recurrence. |
| `recurrence_day_of_month` | `smallint` | Yes | `1-31`. Required for monthly recurrence. |
| `completed_at` | `timestamptz` | Yes | Set when completed. |
| `deleted_at` | `timestamptz` | Yes | Soft-delete marker adopted in v1 for swipe-delete undo and operational safety. |
| `created_at` | `timestamptz` | No | Default `now()`. |
| `updated_at` | `timestamptz` | No | Default `now()`. |

Constraints and invariants:

- Foreign key ownership must align by user in application logic and migration-time integrity checks.
- `title` must not be blank after trimming.
- `completed_at` is required when `status = 'completed'` and must be null when `status = 'open'`.
- If `reminder_at` is populated, `due_date` must also be populated at the application layer in v1.
- Clearing `due_date` in task editing must also clear `reminder_at`, `reminder_offset_minutes`, and recurrence columns at the application layer.
- `reminder_at` is the canonical task-level reminder timestamp. `reminder_offset_minutes` is retained to support recurrence inheritance.
- Recurrence columns are all null for non-recurring tasks.
- Recurring task rules:
  - `recurrence_frequency = 'daily'` requires no weekday or day-of-month.
  - `recurrence_frequency = 'weekly'` requires `recurrence_weekday`.
  - `recurrence_frequency = 'monthly'` requires `recurrence_day_of_month`.
  - `recurrence_interval` is fixed to `1` in v1.
- Only one future open task should exist per `series_id`.
- Moving a flagged task to a different group clears `needs_review` at the application level.

### `subtasks`

Flat checklist items attached to a parent task.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `uuid` | No | Primary key. |
| `task_id` | `uuid` | No | Foreign key to `tasks.id`. |
| `user_id` | `uuid` | No | Foreign key to `users.id`. |
| `title` | `text` | No | Non-empty subtask title. |
| `is_completed` | `boolean` | No | Defaults to `false`. |
| `completed_at` | `timestamptz` | Yes | Optional completion timestamp. |
| `created_at` | `timestamptz` | No | Default `now()`. |
| `updated_at` | `timestamptz` | No | Default `now()`. |

Constraints and invariants:

- Subtasks do not nest.
- Subtasks do not carry due dates, reminders, or recurrence.
- Completing all subtasks does not auto-complete the parent task.

### `captures`

Bounded-retention record of capture attempts and transcript review state.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `uuid` | No | Primary key. |
| `user_id` | `uuid` | No | Foreign key to `users.id`. |
| `input_type` | `text` | No | `voice` or `text`. |
| `status` | `capture_status` | No | Tracks transcription/extraction progress. |
| `source_text` | `text` | Yes | Original manual text capture when input type is text. |
| `transcript_text` | `text` | Yes | Current transcript shown for review. |
| `transcript_edited_text` | `text` | Yes | User-edited transcript snapshot if submitted. |
| `transcription_provider` | `text` | Yes | Initial provider name, for example `mistral`. |
| `transcription_latency_ms` | `integer` | Yes | Optional provider latency metric. |
| `extraction_attempt_count` | `smallint` | No | Defaults to `0`. |
| `tasks_created_count` | `integer` | No | Defaults to `0`. |
| `tasks_skipped_count` | `integer` | No | Defaults to `0`. |
| `error_code` | `text` | Yes | Sanitized failure category. |
| `expires_at` | `timestamptz` | No | Retention cutoff. Initial target is 7 days after creation. |
| `created_at` | `timestamptz` | No | Default `now()`. |
| `updated_at` | `timestamptz` | No | Default `now()`. |

Constraints and invariants:

- Raw audio bytes, object storage paths, and provider payload blobs are out of scope for v1 storage.
- `expires_at` must always be populated for cleanup eligibility.
- Failed extraction may retain transcript text until `expires_at` to support retry/troubleshooting.
- Logs must not duplicate full transcript text even when `captures` stores it temporarily.

### `reminders`

Single reminder event per task occurrence with transactional claim/send tracking.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `uuid` | No | Primary key. |
| `user_id` | `uuid` | No | Foreign key to `users.id`. |
| `task_id` | `uuid` | No | Foreign key to `tasks.id`. One reminder row per task occurrence in v1. |
| `scheduled_for` | `timestamptz` | No | Absolute reminder send target in UTC. |
| `status` | `reminder_status` | No | Pending lifecycle state. |
| `idempotency_key` | `text` | No | Deterministic key for provider-safe retries. |
| `claim_token` | `uuid` | Yes | Worker-claim token for in-flight sends. |
| `claimed_at` | `timestamptz` | Yes | When a worker claimed the row. |
| `claim_expires_at` | `timestamptz` | Yes | Claim timeout for retry-safe recovery. |
| `send_attempt_count` | `integer` | No | Defaults to `0`. |
| `last_error_code` | `text` | Yes | Sanitized provider or validation error code. |
| `provider_message_id` | `text` | Yes | Message identifier returned by Resend. |
| `sent_at` | `timestamptz` | Yes | When delivery was accepted by the provider. |
| `cancelled_at` | `timestamptz` | Yes | When reminder was cancelled due to task completion or deletion. |
| `created_at` | `timestamptz` | No | Default `now()`. |
| `updated_at` | `timestamptz` | No | Default `now()`. |

Constraints and invariants:

- Unique constraint on `task_id` to enforce one reminder per task occurrence in v1.
- Unique constraint on `idempotency_key`.
- Only due, unsent, still-open reminders are eligible for claiming.
- Completion or deletion of the task cancels a pending reminder instead of sending it.
- Task edits must keep reminder rows in sync so there is never more than one reminder row per task occurrence.
- Reopen or restore only reactivates a reminder when the task still has a future `reminder_at`.
- Worker logic must claim rows transactionally before send.

## Cross-Table Rules

- `tasks.user_id`, `groups.user_id`, `subtasks.user_id`, `captures.user_id`, and `reminders.user_id` must all match the owning `users.id`.
- `tasks.group_id` must reference a group owned by the same user.
- `subtasks.task_id` must reference a task owned by the same user.
- `reminders.task_id` must reference a task owned by the same user.
- `captures.id` may be referenced by tasks created from that capture for traceability and result summaries.

## Indexing Guidance

The initial migration set should include indexes for:

- `groups (user_id, lower(name))` unique
- `groups (user_id, system_key)` unique where `system_key is not null`
- `tasks (user_id, status, group_id)`
- `tasks (user_id, needs_review)` for review filtering
- `tasks (user_id, due_date)`
- `tasks (series_id, status)` for recurrence checks
- `subtasks (task_id)`
- `captures (user_id, created_at desc)`
- `captures (expires_at)` for retention cleanup
- `reminders (status, scheduled_for)`
- `reminders (task_id)` unique
- `reminders (idempotency_key)` unique
- `reminders (claim_expires_at)` for reclaiming stuck claims

## Retention and Cleanup

- Capture rows are retained only until `expires_at`, with an initial default target of 7 days after creation.
- Reminder rows may be retained for audit and idempotency protection after send or cancellation.
- Task, subtask, group, and user retention policy is outside Phase 0 and should not conflict with reminder or capture cleanup.

## Deferred Decisions

The following are intentionally out of scope for the v1 schema contract:

- full-text search
- task-sharing or multi-user collaboration
- attachment storage
- recurring-series exception records
- provider payload archival
- minute-level delivery guarantees
