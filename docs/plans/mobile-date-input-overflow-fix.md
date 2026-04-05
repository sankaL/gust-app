# Mobile Date Input Overflow Fix

## Problem Statement

When editing a task on mobile or narrow viewport devices (viewport width < 640px), the due date and reminder date input fields overflow horizontally beyond their parent container. The component displays correctly on larger screens but breaks containment on smaller viewports.

## Root Cause Analysis

### Primary Cause: Grid Item Intrinsic Width Constraint

In [`TaskFormFields.tsx`](frontend/src/components/TaskFormFields.tsx:248), the grid container uses:

```tsx
<div className="grid min-w-0 gap-3 sm:grid-cols-2">
```

Each grid item (the date input cards) has:

```tsx
<div className="min-w-0 rounded-[1.35rem] bg-black/20 p-4 backdrop-blur-sm">
```

**The issue**: `min-w-0` on a grid item does not constrain its children's intrinsic minimum width. Native `<input type="date">` and `<input type="datetime-local">` elements have browser-imposed intrinsic minimum widths due to:

- The date picker UI (calendar icon, spinner controls)
- The formatted date text (e.g., "MM/DD/YYYY" or "YYYY-MM-DD")
- Browser-native padding and internal shadow DOM elements

On narrow viewports (320px-375px), the combination of:

1. **`p-4` padding** (1rem = 16px each side = 32px total horizontal)
2. **Input's intrinsic minimum width** (~150-180px for native date pickers)
3. **Available container width** (modal `max-w-md` = 448px minus `p-4` = 32px = 416px available)

causes the content to overflow when the grid column width shrinks below the input's intrinsic minimum.

### Secondary Cause: Missing `overflow-hidden` on Card Containers

The card containers don't have `overflow-hidden`, so when the input element's intrinsic width exceeds the available space, it visually spills out of the rounded container.

### Tertiary Cause: No Responsive Padding Adjustment

The `p-4` padding is fixed across all breakpoints. On very narrow screens (320px-375px), this padding consumes a disproportionate amount of the available width, leaving less room for the actual input element.

## Solution

### Changes to [`TaskFormFields.tsx`](frontend/src/components/TaskFormFields.tsx)

#### 1. Add `overflow-hidden` to card containers

Add `overflow-hidden` to each card container to clip any content that exceeds the container bounds:

```tsx
// Before
<div className="min-w-0 rounded-[1.35rem] bg-black/20 p-4 backdrop-blur-sm">

// After
<div className="min-w-0 overflow-hidden rounded-[1.35rem] bg-black/20 p-4 backdrop-blur-sm">
```

#### 2. Add responsive padding to card containers

Reduce padding on small screens to maximize available width for inputs:

```tsx
// Before
<div className="min-w-0 rounded-[1.35rem] bg-black/20 p-4 backdrop-blur-sm">

// After
<div className="min-w-0 overflow-hidden rounded-[1.35rem] bg-black/20 p-3 sm:p-4 backdrop-blur-sm">
```

This uses `p-3` (12px) on mobile and `p-4` (16px) on screens >= 640px.

#### 3. Add `w-full` and explicit width constraints to date inputs

Ensure the date inputs are explicitly constrained to their parent's width:

```tsx
// Before
<input
  type="date"
  value={dueDate}
  onChange={(e) => handleDueDateChange(e.target.value)}
  className="mt-3 block w-full min-w-0 max-w-full rounded-card bg-surface-dim px-3 py-3 pr-8 text-sm font-medium text-on-surface outline-none focus:bg-surface-container-high"
  style={{ fontSize: '16px' }}
  disabled={disabled}
/>

// After
<input
  type="date"
  value={dueDate}
  onChange={(e) => handleDueDateChange(e.target.value)}
  className="mt-3 block w-full min-w-0 max-w-full rounded-card bg-surface-dim px-3 py-3 pr-8 text-sm font-medium text-on-surface outline-none focus:bg-surface-container-high"
  style={{ fontSize: '16px', width: '100%', boxSizing: 'border-box' }}
  disabled={disabled}
/>
```

The inline `width: '100%'` and `boxSizing: 'border-box'` override any browser-native intrinsic width behavior.

#### 4. Apply the same fix to all date/datetime inputs

The same changes need to be applied to:
- Due date input (line ~254-261)
- Reminder datetime-local input (line ~269-276)
- Day of month number input for monthly recurrence (line ~374-384)
- Day of month number input for yearly recurrence (line ~410-420)

### Summary of All Changes

| Line Range | Element | Change |
|------------|---------|--------|
| 250 | Due date card container | Add `overflow-hidden`, change `p-4` to `p-3 sm:p-4` |
| 254-261 | Due date input | Add `width: '100%', boxSizing: 'border-box'` to style |
| 265 | Reminder card container | Add `overflow-hidden`, change `p-4` to `p-3 sm:p-4` |
| 269-276 | Reminder input | Add `width: '100%', boxSizing: 'border-box'` to style |
| 284-285 | Group card container | Add `overflow-hidden`, change `p-4` to `p-3 sm:p-4` |
| 309 | Recurrence display card | Add `overflow-hidden`, change `p-4` to `p-3 sm:p-4` |
| 351 | Weekly day of week card | Add `overflow-hidden`, change `p-4` to `p-3 sm:p-4` |
| 370 | Monthly day of month card | Add `overflow-hidden`, change `p-4` to `p-3 sm:p-4` |
| 374-384 | Monthly day of month input | Add `width: '100%', boxSizing: 'border-box'` to style |
| 390 | Yearly month+day card | Add `overflow-hidden`, change `p-4` to `p-3 sm:p-4` |
| 410-420 | Yearly day of month input | Add `width: '100%', boxSizing: 'border-box'` to style |

## Verification

After applying the fix:

1. **Mobile viewport (320px-375px)**: Date inputs should be fully contained within their card containers with no horizontal overflow
2. **Tablet viewport (768px)**: Two-column grid layout should display correctly
3. **Desktop viewport (1024px+)**: Two-column grid layout should display correctly
4. **Touch targets**: All inputs should maintain minimum 44x44px touch targets (the `py-3` padding ensures this)
5. **Accessibility**: All inputs should remain focusable and usable with keyboard navigation

## Risk Assessment

- **Low risk**: The changes are purely CSS-based and additive
- **No behavioral changes**: The fix only affects visual containment, not functionality
- **Backward compatible**: The responsive padding (`p-3 sm:p-4`) maintains the existing desktop appearance while fixing mobile overflow
