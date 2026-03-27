# PRD: Gust

**Version:** 2.0  
**Last Updated:** 2026-03-27  
**Domain:** gustapp.ca

## Product Summary

Gust is a personal, voice-first task manager designed for fast capture on mobile. The primary user action is:

1. Open the app
2. Tap the mic
3. Speak naturally
4. Review the transcript
5. Submit
6. Receive structured tasks in the correct group with dates, reminder metadata, and review flags where needed

The product is optimized for low-friction capture, not for deep project management.

## Goals

- Make voice capture the default way to add tasks on mobile.
- Turn messy spoken input into usable tasks without interrupting the user for clarification.
- Keep manual cleanup lightweight when AI confidence is low.
- Support a small but reliable task model: groups, subtasks, due dates, reminders, and simple recurrence.
- Ship as an installable mobile-first web app.

## Non-Goals

- Team collaboration or task sharing
- Nested subtasks
- Push notifications
- Full offline task creation and sync
- Rich note-taking or document storage
- Natural-language back-and-forth chat with the assistant

## Target User

An individual user who thinks out loud, captures tasks on the go, and wants the app to organize the result with minimal keyboard use.

## Product Principles

- Voice first: every primary flow must work well on a phone without typing.
- Fail closed: invalid auth, missing config, or malformed AI output must not create silent corruption.
- Silent automation, visible review: the app should not interrupt capture, but it must clearly surface uncertain results afterward.
- Mobile ergonomics over density: large touch targets, short flows, minimal configuration.
- Honest system behavior: reminder timing, AI confidence, and failure states must be explicit.

## V1 Scope

### 1. Capture

The Capture screen is the default screen on launch.

It supports two input modes:

- Voice capture via the active device microphone
- Manual text entry as a fallback

Voice is the primary mode. Text input is available but visually secondary.

### 2. Tasks

The Tasks screen shows open tasks grouped by user-defined groups.

The Tasks surface keeps the primary shell at `Capture` and `Tasks`.
Group management lives on a full-screen Tasks-adjacent route instead of a third primary tab.

Each task supports:

- Title
- Group
- Due date
- Optional reminder time
- `needs_review` state
- Completion
- Deletion
- Optional recurrence
- Optional subtasks

### 3. Group Management

Users can:

- Create groups
- Rename groups
- Edit group descriptions
- Delete non-system groups

Group descriptions exist to improve AI routing and are user-editable.
Group management is reached from the Tasks area and is not a primary navigation tab.

### 4. Authentication

Users sign in with Google. All application data is scoped per user.
Authentication uses a dedicated `/login` screen and redirects signed-out access away from protected task/capture routes.
The authenticated shell includes a top-right account avatar menu with entries for `Completed Tasks`, `Desktop Mode` (placeholder), and `Logout`.

### 5. Email Digests

Users receive exactly two digest email types from this workflow:

- Daily brief per user at 8:30 AM Eastern with open tasks due today and overdue open tasks
- Weekly summary per user on Sunday at 9:00 AM Eastern with tasks completed this week and due-this-week tasks still open

No other reminder or digest email type is sent from this flow.

### 6. Installable PWA

The app is installable on iPhone Safari and Android Chrome and behaves like a fullscreen app when launched from the home screen.

## Core User Flows

### Flow A: Voice Capture

1. User opens the app and sees a large mic control.
2. User taps once to start recording.
3. User taps again to stop.
4. App sends audio for transcription.
5. App displays the transcript for review and optional edit.
6. User submits the transcript.
7. Backend extracts tasks and writes validated tasks.
8. App shows a result summary:
   - tasks created
   - tasks flagged for review
   - any items skipped due to validation failure

### Flow B: Text Capture

1. User expands the text input.
2. User types or pastes freeform text.
3. User submits.
4. Extraction and result handling are identical to the voice flow.

### Flow C: Task Review

1. User opens the Tasks screen.
2. The app defaults to Inbox on first load and preserves the selected group in the URL afterward.
3. Open tasks for the selected group are shown in `Overdue`, `Due Soon`, and `No Date` sections.
4. `Due Soon` means today through the next 3 calendar days in the user's timezone.
5. Flagged tasks are visually marked.
6. User can complete or delete from the list with a visible undo path.
7. Deleting a recurring task prompts for `Delete this occurrence` or `Delete this and future`.
8. User can open a per-group Completed Tasks page and move completed tasks back to To-do.
9. User opens a task to edit it and saves the draft explicitly.
10. Moving a flagged task to a different group clears `needs_review`.

### Flow D: Digest Delivery

1. User creates and updates tasks through normal capture/task flows.
2. A daily backend digest job (8:30 AM Eastern) sends one per-user brief with due-today and overdue open tasks.
3. A weekly backend digest job (Sunday 9:00 AM Eastern) sends one per-user summary for the Monday-Sunday week window.
4. If a user's digest has no items for that period, the send is skipped.

## Page Requirements

### Capture

Required behavior:

- Large central mic button
- Recording state is visually distinct
- Transcript review appears before task creation
- Text fallback is available but collapsed by default
- User can cancel before submission
- User can retry after a failed transcription or extraction

Required failure handling:

- If mic permission is denied, the app must show a clear error and keep text capture available.
- If transcription fails, no tasks are created and the user can retry.
- If extraction fails, the transcript stays visible so the user can retry or edit.
- If zero actionable tasks are found, the app must say so explicitly and create nothing.

### Tasks

Open tasks are shown by group.

Within each group, sorting is:

1. Overdue
2. Due soon
3. No due date

`Due Soon` means tasks due today through the next 3 calendar days in the user's timezone.

Within each due bucket, flagged tasks appear before unflagged tasks.

Each task card shows:

- Title
- Due date badge, if present
- Group label
- Review indicator, if `needs_review = true`

Task interactions:

- Swipe right completes
- Swipe left deletes with an undo affordance
- Recurring delete requires explicit scope choice (`this occurrence` vs `this and future`)
- Explicit complete and delete actions exist as keyboard/desktop fallbacks
- Tap opens full-screen detail editing

### Completed Tasks

Completed tasks are available on a dedicated Tasks-adjacent route.

Required behavior:

- Completed list is filtered per selected group.
- Account menu entry opens an all-groups completed view (`group=all`) without changing per-group explicit routing.
- Soft-deleted tasks do not appear in the completed list.
- Completed items are sorted newest-first by `completed_at`.
- The completed list suppresses obvious duplicate historical rows for the same logical occurrence.
- Each row can be moved back to To-do through reopen behavior.
- Reopen conflicts must show a user-safe error.

### Task Detail

Editable fields:

- Title
- Description
- Group
- Due date
- Reminder time
- Recurrence
- Subtasks

Detail editing uses a local draft with an explicit save action.
If the user clears the due date, the app must also clear the reminder and recurrence before save so the payload remains valid.
V1 recurrence editing is limited to `daily`, `weekly`, and `monthly`.

V1 does not include rich notes, attachments, or nested subtasks.

### Groups

Users can manage groups from a full-screen Tasks-adjacent screen.

Each custom group has:

- Name
- Optional description

System behavior:

- Every user has exactly one system Inbox group.
- Inbox is created automatically for each user.
- Inbox cannot be deleted or renamed in v1.
- All tasks always belong to a group. `group_id` is never null in the product contract.

If a user deletes a custom group, they must choose a destination group for its open tasks before deletion completes.

## AI Behavior

### Transcription Contract

- Voice input is transcribed server-side.
- Raw audio is used only for transcription and is not retained after processing in v1.
- The transcription result is shown to the user before extraction.

### Extraction Contract

For each submitted transcript, the backend sends the extractor:

- The normalized transcript text
- The user timezone
- The current local date for that user
- All user groups
- Each group description
- Up to 5 recent incomplete task titles per group

The extractor must return structured JSON matching the backend schema. Each returned task candidate can include:

- `title`
- `description`
- `due_date`
- `reminder_at`
- `group_id` or `group_name`
- `top_confidence`
- `alternative_groups`
- `recurrence`
- `subtasks`

Behavioral rules:

- Extract every actionable item from the transcript.
- Preserve useful short context in `description` when the title alone would lose meaning; use null when there is no meaningful extra context.
- Resolve relative dates using the user's timezone and the server-provided current date.
- Never invent new groups.
- Prefer Inbox when confidence is low.
- Only set a reminder when the source clearly implies one.
- Only set recurrence when the source clearly implies recurrence.

### Validation Rules

The backend validates extractor output before any write.

- Invalid items are rejected individually.
- Valid items from the same capture may still be created.
- The response to the user must disclose if any items were skipped.
- If the full extractor payload is malformed, the backend may perform one bounded retry.
- The backend also performs a semantic completeness check for guarded cross-domain intents such as medical calls, appointments, and similar standalone errands.
- If a guarded intent is missing from extracted tasks (including subtasks), the backend performs one bounded corrective re-extraction with the missing clause(s) called out explicitly.
- If the guarded intent is still missing after the corrective retry, the backend creates a low-confidence Inbox review task instead of silently dropping it.
- If validation still fails after retry, no tasks are created from that submission.

### Confidence Routing

Assignment rules:

- High confidence: top group score `>= 0.80`
  - assign to top group
  - `needs_review = false`
- Ambiguous: top group score `0.50` to `0.79`
  - assign to top group
  - `needs_review = true`
- Low confidence: top group score `< 0.50`
  - assign to Inbox
  - `needs_review = true`
- Tie: two or more groups within `0.10` of each other and both `>= 0.50`
  - assign to Inbox
  - `needs_review = true`

The user is not interrupted during capture. Review happens after the write.

## Task Domain Contract

### Task Lifecycle

Task states in v1:

- Open
- Completed

Completing a task removes it from the default task list immediately and is recoverable through undo-backed reopen behavior.
Deleting a task removes it from active use immediately through soft delete and is recoverable through undo-backed restore behavior.
Completed tasks are hidden from the default task list in Phase 3.
Completed tasks remain available in per-group and all-groups Completed Tasks views.

### Required Task Fields

At the product-contract level, a task must support:

- Stable ID
- User ID
- Group ID
- Title
- Optional short description
- Status
- `needs_review`
- Due date, nullable
- Reminder time, nullable
- Recurrence definition, nullable
- Created timestamp
- Completed timestamp, nullable

### Subtasks

Subtasks are intentionally simple:

- title
- completed state
- created timestamp

Subtasks:

- belong to a parent task
- do not have reminders
- do not have due dates
- do not nest
- do not auto-complete the parent task

## Digest Contract

- Digest email delivery is optional per user but, when enabled, only two job-triggered digest types are active: `daily` and `weekly`.
- Daily digest period basis is fixed Eastern (`America/New_York`) and includes:
  - open tasks due on the current Eastern date
  - open tasks overdue before the current Eastern date
- Weekly digest period basis is fixed Eastern (`America/New_York`) and includes:
  - completed tasks with `completed_at` in the Monday-Sunday Eastern window
  - open tasks with `due_date` in that Monday-Sunday Eastern window
- Digest sending is idempotent per `user + digest_type + period`.
- Empty digests are not sent and must be tracked as skipped.
- Retryable delivery failures may retry without duplicate-send; terminal provider failures must not duplicate-send.
- No per-task reminder emails are sent in v1 from this workflow.
- No push notifications in v1.

## Recurrence Contract

V1 recurrence is intentionally narrow.

Supported frequencies:

- Daily
- Weekly
- Monthly

Not supported in v1:

- Arbitrary custom intervals
- Multiple weekdays in one rule
- “Last business day”
- Per-series exceptions
- Editing one occurrence versus all occurrences

Behavior:

- A recurring task generates the next occurrence when the current occurrence is completed.
- The next occurrence is created in the same group.
- Only one future open occurrence should exist for a series at a time.
- Daily recurrence creates the next local calendar day after completion.
- Weekly recurrence repeats on a single weekday.
- Monthly recurrence repeats on the day-of-month of the completed occurrence; if that day does not exist in the next month, it falls to the last day of that month.
- If a recurring task has reminder metadata, the next occurrence inherits the same relative offset from the due date.
- If that inherited reminder timestamp would already be in the past at completion time, the generated occurrence clears `reminder_at`.
- Deleting a recurring occurrence generates the next occurrence based on the deleted occurrence due date when no other open occurrence exists in the series.
- Deleting recurring `this and future` soft-deletes all open occurrences in the series and does not delete completed history.
- Reopening or restoring a recurring occurrence keeps recurrence only when the generated undo-target occurrence is found; otherwise it reopens/restores as a single detached non-recurring instance.

## Timezone Contract

Relative date resolution for extraction, due buckets, and task semantics uses the user's IANA timezone.

Digest delivery windows use fixed Eastern (`America/New_York`) period boundaries.

V1 behavior:

- The frontend provides the browser timezone after sign-in.
- The backend persists the current user timezone.
- If the client reports a different timezone later, the backend updates it for future resolution and reminder metadata handling.

## Privacy and Data Handling

- Auth tokens must not be stored in browser localStorage.
- Raw audio is not retained after transcription.
- Transcripts may be retained temporarily for troubleshooting and replay of a failed extraction flow, but only for a bounded retention period.
- The initial retention target is 7 days for capture records.
- Logs must not contain auth tokens, raw provider payloads, or full transcript text.
- Digest emails contain only the minimum task information needed to be useful.

## Security Requirements

- Every data mutation requires an authenticated user.
- All reads and writes must be scoped by user identity.
- Missing or invalid auth must fail closed.
- AI provider keys remain server-side only.
- Destructive actions require either explicit confirmation or a visible undo path.

## Success Metrics

Launch metrics for v1:

- P50 voice-capture-to-task-write time under 5 seconds for a 30-second recording on a stable network
- P90 voice-capture-to-task-write time under 8 seconds for the same scenario
- Group assignment accuracy above 80% on a labeled validation set
- Less than 10% of created tasks marked `needs_review`
- Digest duplicate-send rate of 0
- Successful install and core flow operation on:
  - iPhone Safari
  - Android Chrome

## Release Blockers

The product is not ready to implement until these contracts are reflected in the source-of-truth schema and migration docs:

- Non-null Inbox group semantics
- Reminder delivery idempotency
- Recurrence representation
- User timezone storage
- Bounded retention for capture records
