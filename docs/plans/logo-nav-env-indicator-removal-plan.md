# Plan: Logo Navigation + Environment Indicator Removal + Orientation Lock

## Overview

Three frontend changes to implement:
1. Lock screen orientation in mobile mode (portrait only)
2. Make logo clickable to navigate to capture page (`/`)
3. Remove environment mode label from login page and app header

---

## Task 1: Lock Screen Orientation (Portrait Mode Only)

### Files to Modify
- [`frontend/index.html`](frontend/index.html)
- [`frontend/src/styles.css`](frontend/src/styles.css) (may need to create or modify)

### Implementation

**Step 1.1:** Update the viewport meta tag in `index.html` to include `viewport-fit=cover`:

```html
<!-- Before (line 5) -->
<meta name="viewport" content="width=device-width, initial-scale=1.0" />

<!-- After -->
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

**Step 1.2:** Add CSS to `styles.css` to lock orientation and prevent landscape:

```css
/* Lock body height to viewport to prevent scroll in landscape */
html, body {
  height: 100%;
  overflow: hidden;
  position: fixed;
  width: 100%;
}

/* Allow internal scrolling within app content */
#root {
  height: 100%;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
```

**Note:** This CSS approach forces the app to only render within portrait dimensions. On iOS Safari, the `viewport-fit=cover` combined with fixed positioning prevents the address bar from expanding and causing layout shifts.

---

## Task 2: Make Logo Clickable (Navigate to Capture Page)

### Files to Modify
- [`frontend/src/components/AppShell.tsx`](frontend/src/components/AppShell.tsx:216-219)

### Implementation

**Step 2.1:** Wrap the logo section in a `Link` component (already imported from react-router-dom at line 4).

Current code (lines 216-219):
```tsx
<div className="flex items-center gap-2">
  <img src="/logos/gust-wind-electric.svg" alt="Gust" className="h-6 w-6" />
  <h1 className="font-display text-2xl leading-none text-on-surface">Gust</h1>
</div>
```

**After (replace with):**
```tsx
<Link to="/" className="flex items-center gap-2">
  <img src="/logos/gust-wind-electric.svg" alt="Gust" className="h-6 w-6" />
  <h1 className="font-display text-2xl leading-none text-on-surface">Gust</h1>
</Link>
```

---

## Task 3: Remove Environment Mode Indicator

### Files to Modify
- [`frontend/src/routes/LoginRoute.tsx`](frontend/src/routes/LoginRoute.tsx:73-75)
- [`frontend/src/components/AppShell.tsx`](frontend/src/components/AppShell.tsx:234-236)
- [`frontend/src/lib/config.ts`](frontend/src/lib/config.ts:4) (remove field)

### Implementation

**Step 3.1:** Remove environment label from login page.

In `LoginRoute.tsx`, remove lines 73-75:
```tsx
<p className="font-body text-xs uppercase tracking-[0.15em] text-on-surface-variant">
  {config.environmentLabel}
</p>
```

Also remove the `config` variable on line 35 since it's only used for `environmentLabel`:
```tsx
const config = getAppConfig()  // Remove this line
```

**Step 3.2:** Remove environment label from app header.

In `AppShell.tsx`, remove the div containing the environment label (lines 234-236):
```tsx
<div className="rounded-pill bg-surface-container-high px-2 py-1 text-right shadow-ambient">
  <p className="font-body text-xs font-medium">{config.environmentLabel}</p>
</div>
```

**Step 3.3:** Clean up config.ts.

In `config.ts`, remove `environmentLabel` from the `AppConfig` type and the return object:

Type (line 4):
```ts
// Before
environmentLabel: string

// Remove this line
```

Return object (line 40):
```ts
// Before
environmentLabel: devMode ? 'Local dev mode' : 'Standard mode'

// Remove this line
```

---

## Summary of Changes

| File | Change Type | Lines Affected |
|------|-------------|----------------|
| `frontend/index.html` | Modify | 5 |
| `frontend/src/styles.css` | Add | New CSS rules |
| `frontend/src/components/AppShell.tsx` | Modify | 216-219 (logo), 234-236 (env label) |
| `frontend/src/routes/LoginRoute.tsx` | Modify | 73-75 (env label), 35 (config variable) |
| `frontend/src/lib/config.ts` | Modify | 4, 40 (environmentLabel field) |

---

## Testing Checklist

After implementing:

1. **Orientation Lock Test:**
   - Open app on mobile device or Chrome DevTools mobile emulation
   - Rotate device to landscape - screen should NOT rotate
   - Verify app remains in portrait orientation

2. **Logo Navigation Test:**
   - Click the logo in the app header
   - Should navigate to capture page (`/`)
   - Works from any page (tasks, groups, etc.)

3. **Environment Label Removal Test:**
   - Login page: environment label should NOT be visible
   - App header: environment label should NOT be visible next to avatar
   - No console errors related to missing `environmentLabel`

---

## Notes

- The `devMode` field in `config.ts` is kept since it may be useful for future feature flags, even though `environmentLabel` is removed.
- The `getAppConfig()` function is still called in `AppShell.tsx` but only for potential future use; verify no other usage breaks if cleaning up further.
