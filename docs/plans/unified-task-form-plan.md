# Unified Task Form Implementation Plan

## Problem Statement

1. **Inconsistent UIs**: Three different task editing interfaces exist:
   - `EditExtractedTaskModal` - modal dialog (used for captured tasks and manual add)
   - `TaskDetailRoute` edit mode - modern inline editing (used for existing tasks)
   - These look and behave differently despite performing the same function

2. **iOS Mobile Issues**:
   - Due date and recurrence inputs overflow off-screen (visible in screenshot)
   - Screen auto-zooms when focusing text inputs and doesn't zoom out after editing

## Solution Overview

Create a single shared `TaskForm` component that renders consistently across all three scenarios, with iOS-specific fixes for zoom and overflow.

## Architecture

### Component Structure

```
frontend/src/components/
├── TaskForm.tsx          # NEW: Shared form component
├── TaskFormModal.tsx     # NEW: Modal wrapper for TaskForm
├── EditExtractedTaskModal.tsx  # MODIFIED: Uses TaskFormModal
└── ...

frontend/src/routes/
├── TaskDetailRoute.tsx   # MODIFIED: Uses TaskForm for edit mode
└── TasksRoute.tsx        # No changes (uses EditExtractedTaskModal)
```

### TaskForm Props Interface

```typescript
interface TaskFormProps {
  // Mode
  mode: 'create' | 'edit'
  
  // Initial values (for edit mode)
  initialTitle?: string
  initialDescription?: string
  initialGroupId?: string
  initialDueDate?: string
  initialReminderAt?: string
  initialRecurrence?: TaskRecurrence | null
  
  // Options
  groups: GroupSummary[]
  defaultGroupId?: string
  
  // Callbacks
  onSave: (data: TaskFormData) => Promise<void>
  onCancel?: () => void
  
  // State
  isSaving?: boolean
  error?: string | null
}

interface TaskFormData {
  title: string
  description: string
  groupId: string
  dueDate: string
  reminderAt: string
  recurrence: TaskRecurrence | null
}
```

## Design Decisions

### 1. Visual Style
- **Adopt TaskDetailRoute aesthetic**: The modern card-based design with gradient backgrounds
- **Use design system tokens**: All colors from CSS variables, proper border-radius tokens
- **Consistent spacing**: Follow Design.md spacing scale

### 2. iOS Zoom Fix
Root cause: iOS Safari auto-zooms when focusing inputs with font-size < 16px

Solutions:
- Set `text-base` (16px) minimum on ALL inputs
- Alternative: Add CSS `touch-action: manipulation` to prevent double-tap zoom
- Update viewport meta tag: `maximum-scale=1, user-scalable=no` (optional, affects accessibility)

### 3. Overflow Fix
Root cause: Date inputs have intrinsic width that exceeds container on small screens

Solutions:
- Add `min-w-0` to parent containers
- Add `max-w-full` to inputs
- Use `box-sizing: border-box` on all inputs
- Consider `text-overflow: ellipsis` for long date strings

## Implementation Steps

### Phase 1: Create TaskForm Component

**File**: `frontend/src/components/TaskForm.tsx`

Features:
- Form state management for all fields
- Validation (title required, recurrence rules)
- Consistent styling matching TaskDetailRoute edit mode
- Proper input types (date, datetime-local, text, textarea)
- Recurrence frequency selection with conditional weekday/month day fields

Styling highlights:
- Main container: gradient background card with shadow
- Inputs: `bg-surface/60`, rounded-[1.25rem], proper padding
- Labels: uppercase tracking, small text, muted color
- Grid layout for date/reminder/group fields (2-col on larger screens)
- Full-width recurrence section

### Phase 2: Create TaskFormModal Wrapper

**File**: `frontend/src/components/TaskFormModal.tsx`

A thin wrapper that:
- Provides modal backdrop and positioning
- Includes header with title ("Add Task" or "Edit Task")
- Includes footer with Cancel/Save buttons
- Delegates form rendering to TaskForm

### Phase 3: Update EditExtractedTaskModal

**File**: `frontend/src/components/EditExtractedTaskModal.tsx`

Replace internal form with TaskFormModal:
- Keep existing props interface for backward compatibility
- Remove all internal form state (move to TaskForm)
- Remove all form JSX (move to TaskForm)
- Keep API call logic for save handler

### Phase 4: Update TaskDetailRoute

**File**: `frontend/src/routes/TaskDetailRoute.tsx`

Replace edit mode form with TaskForm:
- Keep existing draft state management
- Replace inline form JSX with TaskForm component
- Maintain optimistic updates and cache management
- Keep subtasks section separate (not part of TaskForm)

### Phase 5: iOS Fixes

**File**: `frontend/src/styles.css`

Add:
```css
/* Prevent iOS zoom on input focus */
input, textarea, select {
  font-size: 16px; /* Minimum to prevent zoom */
}

/* Better mobile input sizing */
input[type="date"],
input[type="datetime-local"] {
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
}
```

**File**: `frontend/index.html`

Update viewport (if needed):
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
```

Note: `user-scalable=no` has accessibility implications. Prefer font-size fix first.

## Testing Checklist

- [ ] Manual add task flow (via TasksRoute FAB)
- [ ] Edit captured task flow (via CaptureRoute)
- [ ] Edit existing task flow (via TaskDetailRoute)
- [ ] All fields save correctly
- [ ] Validation works (title required)
- [ ] Recurrence rules work (weekly needs weekday, monthly needs day)
- [ ] Group selection works
- [ ] iOS Safari: No zoom on input focus
- [ ] iOS Safari: Date inputs don't overflow
- [ ] Desktop: No regressions
- [ ] Android: No regressions

## Migration Notes

- EditExtractedTaskModal maintains same props → no changes needed in TasksRoute or CaptureRoute
- TaskDetailRoute uses TaskForm inline → subtasks remain separate
- All existing API calls remain unchanged
- No backend changes required
