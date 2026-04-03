# Subtask Badge Redesign — Collapsed Card State

## Problem
In the task tab's "All" sub-tab, the subtask badge (currently rendered as a text label like "0 subtasks") gets pushed to the bottom of the metadata row when space is limited on collapsed (non-expanded) task cards.

## Solution
Replace the collapsed-state subtask badge with a compact Lucide icon + count badge that:
- Uses a `ListChecks` icon from `lucide-react` to visually depict subtasks
- Shows the subtask count as white text next to the icon
- Uses `--color-info-dim: #1e88e5` as the badge background
- Keeps icon and number in white for contrast
- Is compact enough to not get pushed to the bottom of the row

## Files to Change

### 1. `frontend/package.json`
- Add `lucide-react` as a dependency

### 2. `frontend/src/components/OpenTaskCard.tsx`
- Import `ListChecks` from `lucide-react`
- Replace the collapsed subtask badge (lines 247-251) with a new compact badge:
  ```tsx
  {!isExpanded ? (
    <span className="subtask-badge shrink-0 flex items-center gap-1">
      <ListChecks size={12} className="text-white" />
      <span className="text-white text-[0.65rem] font-bold">{task.subtask_count ?? 0}</span>
    </span>
  ) : null}
  ```
- Remove the `formatSubtaskLabel` function and `subtaskLabel` memo since they're no longer needed for the collapsed state (keep for expanded state)

### 3. `frontend/src/styles.css`
- Add CSS for the `.subtask-badge` class:
  ```css
  .subtask-badge {
    background-color: var(--color-info-dim);
    border-radius: 9999px;
    padding: 0.15rem 0.5rem;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    line-height: 1;
  }
  ```

## Implementation Order
1. Install `lucide-react` via npm
2. Add the `.subtask-badge` CSS to `styles.css`
3. Update `OpenTaskCard.tsx` to use the new badge

## Notes
- The expanded state's subtask label remains unchanged (shows "X subtask(s)" text)
- The `formatSubtaskLabel` function is still used by the expanded state, so it stays
- The `subtask_count` field already exists on `TaskSummary` type (line 78 of api.ts)
