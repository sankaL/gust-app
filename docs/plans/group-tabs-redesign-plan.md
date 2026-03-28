# Group Tabs Redesign Plan

## Overview
Redesign the task page group tabs to prevent overflow as groups increase. Consolidate into three main elements: All, Inbox, and Other (dropdown).

## Requirements

### Layout
- **All** pill: Fixed width, shows all tasks across all groups
- **Inbox** pill: Fixed width, shows inbox group tasks
- **Other** pill: Takes 50% of screen width, contains dropdown for remaining groups

### Visual Design
- Icons for All (Layers) and Inbox (Inbox) using lucide-react
- Chevron-down indicator on the right side of "Other" pill
- Dropdown styled consistently with existing SelectDropdown component
- Active state: Purple gradient with shadow lift
- Inactive state: Surface container with subtle border

### Behavior
- Clicking "Other" opens dropdown with all non-inbox groups
- Selecting a group from dropdown:
  - Changes the pill to show: {GroupName} · {taskCount}
  - Filters tasks to that group
  - Chevron remains visible to indicate it's still a dropdown
- Clicking active pill again keeps it selected
- Follows existing Design.md "Digital Void" aesthetic

## Files to Modify
1. `frontend/src/routes/TasksRoute.tsx` - Replace existing tabs implementation
2. `frontend/package.json` - Add lucide-react dependency

## Component Structure
```
GroupTabs
├── AllButton (icon + text)
├── InboxButton (icon + text)
└── OtherDropdown (50% width)
    ├── Trigger (shows selected group or "Other")
    └── DropdownMenu (lists remaining groups)
```

## Styling Reference
- Active pill: `bg-[radial-gradient(circle_at_top_left,_#5b21b6_0%,_#2e1065_100%)]` with shadow
- Inactive pill: `bg-surface-container-high` with `border-white/5`
- Dropdown: `bg-surface-container-high/95 backdrop-blur-md` per SelectDropdown pattern
- Icons: 16px size, inherit color from parent

## Icons Needed
- `Layers` for All tab
- `Inbox` for Inbox tab  
- `ChevronDown` for dropdown indicator
