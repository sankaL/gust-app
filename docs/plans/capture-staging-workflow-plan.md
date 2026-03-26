# Capture Staging Workflow Implementation Plan

## Overview

This plan implements a staging workflow for voice transcripts in the Gust capture flow. Instead of immediately creating tasks from extracted items, users will review extracted tasks in a staging table before approving them to the final task list.

## Current State

**Current Flow:**
1. User records voice → transcript is created
2. User reviews/edits transcript → submits for extraction
3. Extraction runs → tasks are immediately created in final task list
4. Summary shows created/reviewed/skipped counts

**Problem:** No opportunity to review extracted tasks before they become permanent.

## Desired Flow

**New Flow:**
1. User records voice → transcript is created
2. Expandable transcript card shows snippet (first ~100 chars) with expand button
3. **Extraction runs automatically** (no submit button needed)
4. Below transcript, staging card appears with extracted tasks
5. User reviews staging table:
   - Each task shows: title, group, due date, recurring status, confidence score
   - Low confidence (<0.7) shows "Needs Review" badge
   - User can checkmark tasks to approve or remove with X
6. User can edit transcript and **re-extract** if needed (optional)
7. Approved tasks go to final task list in appropriate group
8. Staging table persists until all tasks are resolved

## Architecture Changes

### 1. Database Schema

**New Table: `extracted_tasks`**

```sql
CREATE TABLE extracted_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    capture_id UUID NOT NULL REFERENCES captures(id),
    title TEXT NOT NULL,
    group_id UUID NOT NULL REFERENCES groups(id),
    group_name TEXT,
    due_date DATE,
    reminder_at TIMESTAMPTZ,
    recurrence_frequency TEXT,
    recurrence_weekday SMALLINT,
    recurrence_day_of_month SMALLINT,
    top_confidence FLOAT NOT NULL,
    needs_review BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'discarded'
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_extracted_tasks_user_id ON extracted_tasks(user_id);
CREATE INDEX idx_extracted_tasks_capture_id ON extracted_tasks(capture_id);
CREATE INDEX idx_extracted_tasks_status ON extracted_tasks(user_id, status);
```

**Key Design Decisions:**
- Lightweight table with only essential fields
- No subtasks in staging (simplified)
- `status` field tracks lifecycle: pending → approved/discarded
- Linked to capture for traceability
- User-scoped for security

### 2. Backend API Endpoints

**New Endpoints:**

```
GET  /captures/{capture_id}/extracted-tasks
     - List all extracted tasks for a capture
     - Returns: Array of ExtractedTask objects

POST /captures/{capture_id}/extracted-tasks/{task_id}/approve
     - Approve a single extracted task
     - Creates task in final task list
     - Updates extracted_task status to 'approved'

POST /captures/{capture_id}/extracted-tasks/{task_id}/discard
     - Discard a single extracted task
     - Updates extracted_task status to 'discarded'

POST /captures/{capture_id}/extracted-tasks/approve-all
     - Approve all pending extracted tasks
     - Creates tasks in final task list
     - Updates all statuses to 'approved'

POST /captures/{capture_id}/extracted-tasks/discard-all
     - Discard all pending extracted tasks
     - Updates all statuses to 'discarded'

POST /captures/{capture_id}/re-extract
     - Re-run extraction on edited transcript
     - Clears existing extracted tasks and creates new ones
     - Returns: ExtractedTask[] with new extraction results
```

**Modified Endpoints:**

```
POST /captures/voice
     - Now automatically triggers extraction after transcription
     - Returns: CaptureReviewResponse with transcript_text
     - Extraction happens in background, tasks appear in staging

POST /captures/text
     - Now automatically triggers extraction after creation
     - Returns: CaptureReviewResponse with transcript_text
     - Extraction happens in background, tasks appear in staging
```

### 3. Backend Service Layer

**New Service: `StagingService`**

```python
class StagingService:
    async def store_extracted_tasks(
        self,
        user_id: str,
        capture_id: str,
        extracted_payload: ExtractorPayload,
        groups: list[GroupContextRecord],
        inbox_group: GroupRecord,
        user_timezone: str
    ) -> list[ExtractedTaskRecord]
    
    async def approve_task(
        self,
        user_id: str,
        capture_id: str,
        extracted_task_id: str
    ) -> TaskRecord
    
    async def discard_task(
        self,
        user_id: str,
        capture_id: str,
        extracted_task_id: str
    ) -> None
    
    async def approve_all(
        self,
        user_id: str,
        capture_id: str
    ) -> list[TaskRecord]
    
    async def discard_all(
        self,
        user_id: str,
        capture_id: str
    ) -> None
    
    async def list_extracted_tasks(
        self,
        user_id: str,
        capture_id: str
    ) -> list[ExtractedTaskRecord]
    
    async def re_extract(
        self,
        user_id: str,
        capture_id: str,
        transcript_text: str
    ) -> list[ExtractedTaskRecord]
```

**Modified: `CaptureService.create_voice_capture` and `create_text_capture`**
- After transcription/creation, automatically trigger extraction
- Store extracted tasks in staging table
- Return transcript for display (extraction happens async)

**New: `CaptureService.re_extract_capture`**
- Clear existing extracted tasks for a capture
- Re-run extraction on edited transcript
- Store new extracted tasks in staging table

### 4. Frontend Changes

**Modified: `CaptureRoute.tsx`**

**New State Variables:**
```typescript
const [extractedTasks, setExtractedTasks] = useState<ExtractedTask[]>([])
const [transcriptExpanded, setTranscriptExpanded] = useState(false)
const [stagingLoading, setStagingLoading] = useState(false)
const [reExtracting, setReExtracting] = useState(false)
```

**UI Changes:**

1. **Expandable Transcript Card:**
   - Shows snippet (first 100 chars) by default
   - Expand button to show full transcript
   - Editable textarea when expanded
   - **"Re-extract" button** appears when transcript is edited
   - Extraction happens automatically on voice/text capture creation

2. **Staging Card:**
   - Appears automatically after extraction completes
   - Shows list of extracted tasks
   - Each task displays:
     - Checkbox for approval
     - X button for discard
     - Task title
     - Group name
     - Due date (if any)
     - Recurring indicator (if any)
     - Confidence score
     - "Needs Review" badge (if confidence < 0.7)
   - "Approve All" and "Discard All" buttons
   - Loading state during extraction

3. **Persistence:**
   - On mount, fetch any pending extracted tasks for the user
   - Show staging card if pending tasks exist
   - New transcripts add to existing staging list

**New Components:**

```typescript
// ExpandableTranscript.tsx
- Shows snippet with expand/collapse
- Editable textarea when expanded
- Submit button

// StagingTable.tsx
- Lists extracted tasks
- Handles approve/discard actions
- Shows confidence badges
- Approve All / Discard All buttons

// ExtractedTaskCard.tsx
- Single task in staging table
- Checkbox, X button, task details
- Confidence badge
```

### 5. Frontend API Functions

**New Functions in `api.ts`:**

```typescript
export type ExtractedTask = {
  id: string
  capture_id: string
  title: string
  group_id: string
  group_name: string
  due_date: string | null
  reminder_at: string | null
  recurrence_frequency: string | null
  recurrence_weekday: number | null
  recurrence_day_of_month: number | null
  top_confidence: number
  needs_review: boolean
  status: 'pending' | 'approved' | 'discarded'
  created_at: string
}

export function listExtractedTasks(captureId: string): Promise<ExtractedTask[]>

export function approveExtractedTask(
  captureId: string,
  taskId: string,
  csrfToken: string
): Promise<TaskDetail>

export function discardExtractedTask(
  captureId: string,
  taskId: string,
  csrfToken: string
): Promise<{ discarded: boolean }>

export function approveAllExtractedTasks(
  captureId: string,
  csrfToken: string
): Promise<TaskDetail[]>

export function discardAllExtractedTasks(
  captureId: string,
  csrfToken: string
): Promise<{ discarded_count: number }>

export function reExtractCapture(
  captureId: string,
  transcriptText: string,
  csrfToken: string
): Promise<ExtractedTask[]>
```

**Modified: `createVoiceCapture` and `createTextCapture`**
- Extraction happens automatically in background
- Return type remains `CaptureReviewResponse` (transcript for display)

## Implementation Order

### Phase 1: Database Schema
1. Create migration for `extracted_tasks` table
2. Add indexes for performance
3. Update `database_schema.md` documentation

### Phase 2: Backend API
1. Create `ExtractedTaskRecord` in repositories
2. Implement `StagingService`
3. Add new API endpoints (approve, discard, re-extract)
4. Modify `create_voice_capture` and `create_text_capture` to auto-extract
5. Add tests for staging operations

### Phase 3: Frontend
1. Add `ExtractedTask` type and API functions
2. Create `ExpandableTranscript` component with re-extract button
3. Create `ExtractedTaskCard` component
4. Create `StagingTable` component
5. Update `CaptureRoute` with new flow (auto-extraction)
6. Add persistence logic (fetch pending tasks on mount)

### Phase 4: Testing & Polish
1. Test complete flow end-to-end
2. Test persistence across page reloads
3. Test multiple transcripts adding to staging
4. Test approve/discard individual and bulk operations
5. Test re-extract functionality
6. Verify confidence badges display correctly
7. Test edge cases (empty extraction, all low confidence, etc.)

## Key Design Decisions

### 1. Staging Table vs. Modified Tasks Table
**Decision:** New `extracted_tasks` table
**Rationale:** 
- Keeps staging separate from final tasks
- Lightweight, no need for full task schema
- Easy to query pending items
- Clear lifecycle management

### 2. Confidence Threshold
**Decision:** 0.7 for "Needs Review" badge
**Rationale:**
- Matches user requirement
- Balances between catching uncertain extractions and not over-flagging
- Can be adjusted later based on feedback

### 3. Persistence Strategy
**Decision:** Fetch pending extracted tasks on component mount
**Rationale:**
- Simple, uses existing API patterns
- No complex state management needed
- Works across page reloads
- User can resolve tasks anytime

### 4. Extraction Trigger
**Decision:** Automatic extraction immediately after voice/text capture creation
**Rationale:**
- Reduces user friction (no submit button needed)
- Matches user expectation ("automatically for the transcript to be sent to extraction")
- User can edit transcript and re-extract if needed
- Extraction happens in background, doesn't block UI

### 5. Re-extract Capability
**Decision:** Allow users to edit transcript and re-extract
**Rationale:**
- Gives users control if extraction results are poor
- Clear existing extracted tasks and create new ones
- Simple "Re-extract" button appears when transcript is edited
- Maintains staging workflow integrity

### 6. Bulk Operations
**Decision:** Include "Approve All" and "Discard All"
**Rationale:**
- Improves UX for users with many extracted tasks
- Common pattern in staging workflows
- Reduces repetitive clicking

## Migration Strategy

### Database Migration
- Create `extracted_tasks` table
- Add foreign key constraints
- Add indexes
- No data migration needed (new feature)

### API Versioning
- New endpoints under `/captures/{capture_id}/extracted-tasks`
- Modified `/captures/{capture_id}/submit` returns different shape
- Frontend will handle both old and new response formats during transition

### Rollback Plan
- If issues arise, revert `submit_capture` to create tasks directly
- Keep `extracted_tasks` table (can be ignored)
- Frontend can fall back to old summary display

## Success Criteria

1. ✅ User can record voice and see expandable transcript
2. ✅ Extraction runs automatically after transcript submission
3. ✅ Extracted tasks appear in staging table with confidence scores
4. ✅ Low confidence tasks show "Needs Review" badge
5. ✅ User can approve or discard individual tasks
6. ✅ User can approve or discard all tasks at once
7. ✅ Approved tasks appear in final task list with correct group
8. ✅ Staging table persists across page reloads
9. ✅ Multiple transcripts add to same staging list
10. ✅ Staging table clears when all tasks are resolved

## Open Questions

1. **Subtasks in staging:** Should extracted subtasks be shown in staging? 
   - **Recommendation:** No, keep staging simple. Subtasks can be added after approval.

2. **Editing in staging:** Should users be able to edit task details (title, group, due date) in staging?
   - **Recommendation:** No, keep staging as review-only. Users can edit after approval.

3. **Maximum staging items:** Should there be a limit on pending extracted tasks?
   - **Recommendation:** No hard limit, but consider pagination if >50 items.

4. **Auto-cleanup:** Should old pending extracted tasks be auto-discarded?
   - **Recommendation:** Yes, after 7 days (matching capture retention).

## Dependencies

- Database migration must run before backend changes
- Backend API must be deployed before frontend changes
- Frontend should handle both old and new API responses during transition

## Timeline Estimate

- Phase 1 (Database): 1-2 hours
- Phase 2 (Backend): 4-6 hours
- Phase 3 (Frontend): 6-8 hours
- Phase 4 (Testing): 2-3 hours
- **Total:** 13-19 hours

## Files to Modify

### Backend
- `backend/alembic/versions/` - New migration
- `docs/database_schema.md` - Update schema docs
- `backend/app/db/schema.py` - Add ExtractedTaskRecord
- `backend/app/db/repositories.py` - Add staging CRUD operations
- `backend/app/services/capture.py` - Modify submit_capture
- `backend/app/services/staging.py` - New staging service
- `backend/app/api/routes/captures.py` - Add staging endpoints
- `backend/tests/test_staging.py` - New tests

### Frontend
- `frontend/src/lib/api.ts` - Add ExtractedTask type and API functions
- `frontend/src/routes/CaptureRoute.tsx` - Major refactor
- `frontend/src/components/ExpandableTranscript.tsx` - New component
- `frontend/src/components/StagingTable.tsx` - New component
- `frontend/src/components/ExtractedTaskCard.tsx` - New component
- `frontend/src/test/capture.test.tsx` - Update tests

### Documentation
- `docs/database_schema.md` - Update with extracted_tasks table
- `docs/PRD-Gust.md` - Update capture flow description
- `docs/build-plan.md` - Update task status
