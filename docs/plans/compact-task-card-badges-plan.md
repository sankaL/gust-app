# Compact Task Card Badges — Responsive Design Plan

## Problem
When screen width is small, badges in collapsed task cards wrap to a new line, causing inconsistent card heights. The goal is to make all collapsed cards the same size regardless of content length by using compact icon-based representations.

## Current State
Collapsed cards show these badges in a row:
1. **Group name** — Full text (e.g., "LOKU CATERS") — can be very long
2. **Due date** — "DUE: APR 5" format
3. **Recurrence** — "ONE-OFF" or "DAILY"/"WEEKLY"/etc.
4. **Subtask count** — Already compact (icon + count)

## Solution
Replace text-heavy badges with compact icon-based representations that show full information on hover via tooltips.

### Compact Badge Design

| Element | Current Display | Compact Display | Tooltip Content |
|---------|----------------|-----------------|-----------------|
| Group | "LOKU CATERS" | Folder icon + 2-char initials | Full group name |
| Due Date | "DUE: APR 5" | Calendar icon + day number | Full date (e.g., "Due: April 5, 2026") |
| Recurrence | "ONE-OFF" | Repeat icon (or none for one-off) | "One-off" or "Recurring: daily" |
| Subtasks | Icon + count | Already compact | "X subtasks" |

### Icon Mapping (from lucide-react)
- **Group**: `Folder` icon
- **Due Date**: `Calendar` icon
- **Recurrence**: `Repeat` icon (only show for recurring tasks)
- **Subtasks**: `ListChecks` icon (already implemented)

### Color Coding
- **Due date**: Keep existing color logic (error for overdue, warning for today, primary for future)
- **Group**: Use `on-surface-variant/85` text color
- **Recurrence**: Use `on-surface-variant/85` text color
- **Subtasks**: Keep existing `info-dim` background

## Implementation Details

### Files to Modify

#### 1. `frontend/src/components/OpenTaskCard.tsx`
- Import icons: `Folder`, `Calendar`, `Repeat` from `lucide-react`
- Add helper functions for compact representations:
  - `getGroupInitials(name: string)` — returns first 2 characters
  - `getDayNumber(dueDate: string)` — returns day of month
- Replace collapsed badge row (lines 219-266) with compact icon-based badges
- Add `title` attributes for tooltip behavior

#### 2. `frontend/src/components/ExtractedTaskCard.tsx`
- Import icons: `Folder`, `Calendar`, `Repeat` from `lucide-react`
- Apply same compact badge pattern (lines 116-135)

#### 3. `frontend/src/styles.css`
- Add CSS for compact badge container:
  ```css
  .compact-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0.15rem 0.35rem;
    border-radius: 9999px;
    font-size: 0.62rem;
    line-height: 1;
    white-space: nowrap;
  }
  ```

### Badge Layout Structure
```
[Folder + "LC"] [Calendar + "5"] [Repeat] [ListChecks + "0"]
```

Each badge is a flex container with:
- Icon (12x12px)
- Short text (2 chars for group, 1-2 digits for day)
- Tooltip via `title` attribute

### Responsive Behavior
- Use `flex-nowrap` to prevent wrapping
- Use `overflow-hidden` with `truncate` on the container
- Badges will maintain consistent size regardless of content length

## Visual Mockup

### Before (current)
```
┌─────────────────────────────────────────────┐
│ Update the thank you sticker with t...    ▼ │
│ ┌──────────┐ ┌────────── ┌─────────┐      │
│ │LOKU CATERS│ │DUE: APR 5│ │ONE-OFF  │      │
│ └──────────┘ └────────── └─────────┘      │
│ ┌──────────┐                                │
│ │≡ 0       │                                │
│ └──────────                                │
└─────────────────────────────────────────────┘
```

### After (proposed)
```
┌─────────────────────────────────────────────┐
│ Update the thank you sticker with t...    ▼ │
│ [📁LC] [📅5] [🔄] [☑0]                      │
└─────────────────────────────────────────────┘
```

## Implementation Order
1. Add CSS for `.compact-badge` class
2. Update `OpenTaskCard.tsx` with compact badges
3. Update `ExtractedTaskCard.tsx` with compact badges
4. Test on various screen sizes (320px, 375px, 414px, 768px)

## Notes
- Keep expanded state unchanged (shows full text labels)
- Tooltip behavior uses native `title` attribute for simplicity
- Icons are 12x12px to maintain compactness
- All badges use `shrink-0` to prevent compression
