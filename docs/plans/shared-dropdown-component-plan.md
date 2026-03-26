# Shared Dropdown Component Plan

## Problem
The `EditExtractedTaskModal` uses native `<select>` HTML elements with `appearance-none` for:
- Group selection (line 159-170)
- Recurrence frequency (line 217-227)  
- Weekday selection for weekly recurrence (line 234-244)

These dropdowns look inconsistent with the Material Design 3-inspired theme and have poor UX.

## Solution
Create a shared `SelectDropdown` component using a popover/menu pattern styled to match the app's theme, then use it in both the extracted task modal and task detail forms.

## Component Design

### SelectDropdown Component (`frontend/src/components/SelectDropdown.tsx`)

**Props Interface:**
```typescript
interface SelectDropdownProps {
  label: string
  options: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
}
```

**Visual Design:**
- Trigger button shows selected value or placeholder with a chevron-down icon
- Dropdown menu appears below with a frosted glass / backdrop blur effect
- Menu items highlight on hover with surface-container-high background
- Selected item shows a checkmark
- Uses theme colors: surface-container-high for menu background, primary for selection indicator

**Behavior:**
- Click outside closes dropdown
- Keyboard navigation (arrow keys, enter, escape)
- Focus management for accessibility

## Implementation Steps

### Step 1: Create SelectDropdown Component
Create `frontend/src/components/SelectDropdown.tsx` with:
- Controlled component state for open/closed
- Popover positioning (below trigger)
- Backdrop blur and themed menu styling
- Accessibility attributes (listbox role, aria-expanded, etc.)

### Step 2: Update EditExtractedTaskModal.tsx
Replace native `<select>` elements with `<SelectDropdown>` for:
- **Group selection** (lines 156-171): Pass `groups` as options, `groupId` as value
- **Recurrence frequency** (lines 214-228): Use existing `FREQUENCIES` array
- **Weekday selection** (lines 230-246): Use existing `WEEKDAYS` array

### Step 3: Update TaskDetailRoute.tsx
Replace native `<select>` for group selection (lines 322-331) with `<SelectDropdown>`

## Files to Modify
1. `frontend/src/components/SelectDropdown.tsx` (new file)
2. `frontend/src/components/EditExtractedTaskModal.tsx` (update)
3. `frontend/src/routes/TaskDetailRoute.tsx` (update)

## Testing Checklist
- [ ] Dropdown opens/closes on click
- [ ] Selecting an option updates the value
- [ ] Clicking outside closes dropdown
- [ ] Keyboard navigation works
- [ ] Visual styling matches theme
- [ ] Works correctly in both modal and page contexts