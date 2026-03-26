# Task Card Redesign Plan

## Objective
Redesign the task cards on the Tasks page to:
1. Remove delete button from card view (accidental click prevention)
2. Show recurring icon when task is recurring
3. Show reminder info (formatted datetime or "none")
4. Show subtasks icon when task has subtasks

## Current State Analysis

### Files Involved
- **Backend:**
  - [`backend/app/db/repositories.py`](backend/app/db/repositories.py) - `TaskRecord` dataclass, `list_tasks()` function
  - [`backend/app/services/task_service.py`](backend/app/services/task_service.py) - `TaskListItem` dataclass
  - [`backend/app/api/routes/tasks.py`](backend/app/api/routes/tasks.py) - `TaskSummaryResponse` Pydantic model

- **Frontend:**
  - [`frontend/src/lib/api.ts`](frontend/src/lib/api.ts) - `TaskSummary` TypeScript type
  - [`frontend/src/routes/TasksRoute.tsx`](frontend/src/routes/TasksRoute.tsx) - `SwipeTaskCard` component

### Current SwipeTaskCard Structure (TasksRoute.tsx lines 93-221)
```
- Swipe right → complete task
- Swipe left → delete task  
- X button → delete task (lines 202-215)
- Complete button (lines 188-201)
```

### Data Flow
```
Repository (list_tasks) 
  → TaskRecord (no subtask_count)
  → TaskService.list_tasks() → TaskListItem
  → API Route (_build_task_summary) → TaskSummaryResponse
  → Frontend API → TaskSummary
  → SwipeTaskCard
```

## Changes Required

### 1. Backend: Add subtask_count to TaskRecord

**File:** [`backend/app/db/repositories.py`](backend/app/db/repositories.py)

**Changes:**
- Add `subtask_count: int` field to `TaskRecord` dataclass (line 63-84)
- Modify `list_tasks()` query (lines 593-612) to:
  - LEFT JOIN with subtasks table
  - COUNT subtasks per task as `subtask_count`
- Update `_row_to_task()` function (lines 194-212) to extract `subtask_count` from row

### 2. Backend: Add subtask_count to TaskListItem

**File:** [`backend/app/services/task_service.py`](backend/app/services/task_service.py)

**Changes:**
- Add `subtask_count: int` field to `TaskListItem` dataclass (lines 53-58)
- Update `list_tasks()` method (lines 89-120) to populate `subtask_count`

### 3. Backend: Add subtask_count to API Response

**File:** [`backend/app/api/routes/tasks.py`](backend/app/api/routes/tasks.py)

**Changes:**
- Add `subtask_count: int = 0` field to `TaskSummaryResponse` (lines 42-54)
- Update `_build_task_summary()` (lines 279-297) to include `subtask_count=item.subtask_count`

### 4. Frontend: Update TypeScript Type

**File:** [`frontend/src/lib/api.ts`](frontend/src/lib/api.ts)

**Changes:**
- Add `subtask_count: number` field to `TaskSummary` type (lines 63-76)

### 5. Frontend: Redesign SwipeTaskCard

**File:** [`frontend/src/routes/TasksRoute.tsx`](frontend/src/routes/TasksRoute.tsx)

**Changes to SwipeTaskCard (lines 93-221):**

#### Remove:
- Delete X button (lines 202-215)
- Swipe-left-to-delete gesture (lines 126-129)
- "Swipe left to delete" text hint (line 138)

#### Add to card content area (around lines 157-218):

**Recurring Icon:**
- Show 🔁 emoji when `task.recurrence_frequency` is set
- Position: next to title or in a metadata row

**Reminder Display:**
- If `task.reminder_at` is set: show formatted datetime (e.g., "Reminder: Mar 26 at 9:00 AM")
- If not set: show "Reminder: none"
- Style: small text, muted color, visually pleasing

**Subtasks Icon:**
- Show 📋 emoji when `task.subtask_count > 0`
- Position: near recurring icon or metadata row

**Layout Suggestion (maintain current styling):**
```tsx
<div className="min-w-0 flex-1 space-y-1">
  {/* Title row with badges */}
  <div className="flex flex-wrap items-center gap-1.5">
    {task.needs_review ? <badge> : null}
    {badge ? <badge> : null}
    {/* New: Recurring icon */}
    {task.recurrence_frequency && <span>🔁</span>}
    {/* New: Subtasks icon */}
    {task.subtask_count > 0 && <span>📋</span>}
  </div>
  <p className="truncate font-display text-base">{task.title}</p>
  <p className="truncate font-body text-xs">{task.group.name}</p>
  
  {/* New: Reminder row */}
  <p className="font-body text-xs text-on-surface-variant">
    Reminder: {task.reminder_at ? formatDateTime(task.reminder_at) : 'none'}
  </p>
</div>
```

#### Keep:
- Swipe right to complete gesture
- "Swipe right to complete" text (update to not mention delete)
- Complete button
- Card styling (background, padding, rounded corners)

### 6. Frontend: Ensure Delete Available on Task Detail

**File:** [`frontend/src/routes/TaskDetailRoute.tsx`](frontend/src/routes/TaskDetailRoute.tsx)

**Verification:**
- Confirm delete task button exists or add one
- The delete should be in the task detail view, not accessible from the list card

## Implementation Order

1. Backend: Add `subtask_count` to `TaskRecord` in repositories.py
2. Backend: Add `subtask_count` to `TaskListItem` in task_service.py  
3. Backend: Add `subtask_count` to `TaskSummaryResponse` in tasks.py API route
4. Frontend: Update `TaskSummary` type in api.ts
5. Frontend: Remove delete button and swipe-left gesture from SwipeTaskCard
6. Frontend: Add recurring icon, reminder display, subtasks icon to SwipeTaskCard
7. Test: Verify delete only works from task detail page

## Visual Design Notes

- **Recurring icon:** 🔁 emoji or Lucide `Repeat` icon
- **Subtasks icon:** 📋 emoji or Lucide `ListTodo` icon  
- **Reminder text:** Small, muted, with label "Reminder:" prefix
- **No reminder:** Show "Reminder: none" in slightly muted style
- **Icons only show when applicable:** Don't show empty states

## Testing Checklist

- [ ] Task cards without recurrence don't show 🔁
- [ ] Task cards with recurrence show 🔁
- [ ] Task cards without subtasks don't show 📋
- [ ] Task cards with subtasks show 📋
- [ ] Task cards with reminder show formatted datetime
- [ ] Task cards without reminder show "Reminder: none"
- [ ] Cannot delete task by swiping left on card
- [ ] Cannot delete task by clicking X on card
- [ ] Can delete task from task detail page
- [ ] Can complete task by swiping right on card
