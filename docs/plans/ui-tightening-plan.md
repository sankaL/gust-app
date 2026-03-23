# UI Tightening & Mobile-First Improvement Plan

## Overview
This plan addresses the user's feedback to make the Gust app UI more compact, minimalistic, and mobile-optimized. The focus is on reducing visual clutter, tightening spacing, and improving interactive elements.

## Issues Identified

### 1. Logo & Header (AppShell.tsx)
**Current State:**
- Lines 18-23: Shows "Voice-first foundation" subtitle + large "Gust" text (text-5xl)
- Lines 24-27: Environment badge with label + value taking vertical space

**Problems:**
- Logo takes up too much vertical space
- "Voice-first foundation" text is unnecessary for daily use
- Environment badge is too prominent

### 2. Mic Button (CaptureRoute.tsx)
**Current State:**
- Lines 304-317: Large 56x56 button with text "Mic" or "Stop"
- Has gradient background but feels flat

**Problems:**
- Text "Mic" instead of proper icon
- Button doesn't feel interactive/clickable
- Needs more visual prominence with glow/shadow effects

### 3. Task List Items (TasksRoute.tsx)
**Current State:**
- Lines 119-179: SwipeTaskCard with p-5 padding
- Lines 135-156: Large text (text-xl) and excessive spacing (space-y-3, space-y-2)
- Lines 159-178: Action buttons with p-2 padding

**Problems:**
- Each task card takes up too much vertical space
- Font sizes are too large for mobile
- Padding is excessive

### 4. General Spacing Issues
**Current State:**
- AppShell.tsx line 15: `px-4 pb-8 pt-6` - excessive top/bottom padding
- AppShell.tsx line 16: `mb-8` - large margin below header
- CaptureRoute.tsx line 272: `space-y-6` - large gaps between sections
- TasksRoute.tsx line 308: `space-y-6` - large gaps between sections

**Problems:**
- Too much whitespace for mobile-first design
- Sections feel disconnected due to large gaps

### 5. Text & Typography
**Current State:**
- Multiple instances of `text-3xl`, `text-2xl`, `text-xl` for headings
- Large body text with `text-base` and `leading-7`
- Excessive uppercase tracking (`tracking-[0.25em]`, `tracking-[0.3em]`)

**Problems:**
- Font sizes too large for mobile
- Tracking wastes horizontal space
- Line heights too generous

## Improvement Plan

### Phase 1: Header & Logo Simplification
**File:** `frontend/src/components/AppShell.tsx`

**Changes:**
1. Remove "Voice-first foundation" subtitle (line 19-21)
2. Reduce "Gust" heading from `text-5xl` to `text-2xl` or `text-3xl`
3. Make environment badge compact:
   - Remove "Environment" label
   - Show only the environment value in smaller text
   - Reduce padding from `px-3 py-2` to `px-2 py-1`
4. Reduce header margin from `mb-8` to `mb-4` or `mb-6`
5. Reduce top padding from `pt-6` to `pt-4`

### Phase 2: Mic Button Enhancement
**File:** `frontend/src/routes/CaptureRoute.tsx`

**Changes:**
1. Replace text "Mic" with SVG microphone icon
2. Add glow effect using box-shadow with primary color
3. Enhance gradient to be more vibrant
4. Add subtle animation/pulse effect when idle
5. Reduce button size from `h-56 w-56` to `h-48 w-48` or `h-40 w-40`
6. Add hover/active states for better feedback

### Phase 3: Task List Tightening
**File:** `frontend/src/routes/TasksRoute.tsx`

**Changes:**
1. Reduce SwipeTaskCard padding from `p-5` to `p-3` or `p-4`
2. Reduce task title from `text-xl` to `text-lg` or `text-base`
3. Reduce spacing between elements:
   - `space-y-3` → `space-y-2` or `space-y-1`
   - `space-y-2` → `space-y-1`
4. Make badges smaller: reduce `px-3 py-1` to `px-2 py-0.5`
5. Reduce action button padding from `px-4 py-2` to `px-3 py-1.5`
6. Reduce section spacing from `space-y-4` to `space-y-3` or `space-y-2`

### Phase 4: Global Spacing Reduction
**Files:** All route components

**Changes:**
1. Reduce section spacing from `space-y-6` to `space-y-4` or `space-y-3`
2. Reduce card padding from `p-6` to `p-4` or `p-3`
3. Reduce container padding from `px-4 pb-8 pt-6` to `px-3 pb-4 pt-3`
4. Reduce margins between major sections

### Phase 5: Typography Optimization
**Files:** All components

**Changes:**
1. Reduce heading sizes:
   - `text-3xl` → `text-2xl` or `text-xl`
   - `text-2xl` → `text-xl` or `text-lg`
   - `text-xl` → `text-lg` or `text-base`
2. Reduce body text from `text-base` to `text-sm` where appropriate
3. Reduce tracking from `tracking-[0.25em]` to `tracking-[0.15em]` or `tracking-[0.1em]`
4. Reduce line heights from `leading-7` to `leading-6` or `leading-5`

### Phase 6: Input & Form Tightening
**Files:** TaskDetailRoute.tsx, ManageGroupsRoute.tsx

**Changes:**
1. Reduce input padding from `px-4 py-4` to `px-3 py-3` or `px-3 py-2`
2. Reduce label sizes from `text-xs` to smaller or remove uppercase
3. Reduce form section spacing

## Specific File Changes

### AppShell.tsx
```tsx
// Before
<header className="mb-8 space-y-4 pt-4">
  <div className="flex items-start justify-between gap-4">
    <div>
      <p className="font-body text-sm uppercase tracking-[0.3em] text-on-surface-variant">
        Voice-first foundation
      </p>
      <h1 className="font-display text-5xl leading-none text-on-surface">Gust</h1>
    </div>
    <div className="rounded-pill bg-surface-container-high px-3 py-2 text-right shadow-ambient">
      <p className="font-body text-xs text-on-surface-variant">Environment</p>
      <p className="font-body text-sm font-medium">{config.environmentLabel}</p>
    </div>
  </div>
</header>

// After
<header className="mb-4 space-y-3 pt-3">
  <div className="flex items-center justify-between gap-3">
    <div className="flex items-center gap-2">
      <img src="/logos/gust-wind-electric.svg" alt="Gust" className="h-6 w-6" />
      <h1 className="font-display text-2xl leading-none text-on-surface">Gust</h1>
    </div>
    <div className="rounded-pill bg-surface-container-high px-2 py-1 text-right shadow-ambient">
      <p className="font-body text-xs font-medium">{config.environmentLabel}</p>
    </div>
  </div>
</header>
```

### CaptureRoute.tsx - Mic Button
```tsx
// Before
<button
  type="button"
  onClick={isRecording ? stopRecording : startRecording}
  disabled={isBusy && !isRecording}
  className={[
    'mx-auto flex h-56 w-56 items-center justify-center rounded-pill border border-white/10 transition',
    isRecording
      ? 'bg-[radial-gradient(circle_at_top,_rgba(253,129,168,0.95),_rgba(140,43,87,0.72))] text-white'
      : 'bg-[radial-gradient(circle_at_top,_rgba(186,158,255,0.92),_rgba(132,85,239,0.82))] text-surface'
  ].join(' ')}
  aria-label={isRecording ? 'Stop recording' : 'Start recording'}
>
  <span className="font-display text-4xl">{isRecording ? 'Stop' : 'Mic'}</span>
</button>

// After
<button
  type="button"
  onClick={isRecording ? stopRecording : startRecording}
  disabled={isBusy && !isRecording}
  className={[
    'mx-auto flex h-48 w-48 items-center justify-center rounded-pill border border-white/10 transition-all duration-300',
    isRecording
      ? 'bg-[radial-gradient(circle_at_top,_rgba(253,129,168,0.95),_rgba(140,43,87,0.72))] text-white shadow-[0_0_60px_rgba(253,129,168,0.5)]'
      : 'bg-[radial-gradient(circle_at_top,_rgba(186,158,255,0.92),_rgba(132,85,239,0.82))] text-surface shadow-[0_0_40px_rgba(186,158,255,0.4)] hover:shadow-[0_0_60px_rgba(186,158,255,0.6)]'
  ].join(' ')}
  aria-label={isRecording ? 'Stop recording' : 'Start recording'}
>
  {isRecording ? (
    <svg className="h-16 w-16" fill="currentColor" viewBox="0 0 24 24">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  ) : (
    <svg className="h-16 w-16" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
      <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
    </svg>
  )}
</button>
```

### TasksRoute.tsx - Task Card
```tsx
// Before
<article className="relative overflow-hidden rounded-card bg-surface-container shadow-ambient">
  <div className="absolute inset-0 flex items-center justify-between px-4 text-xs uppercase tracking-[0.18em] text-on-surface-variant">
    <span>Swipe right to complete</span>
    <span>Swipe left to delete</span>
  </div>
  <button
    type="button"
    onClick={() => onOpen(task.id)}
    onPointerDown={handlePointerDown}
    onPointerMove={handlePointerMove}
    onPointerUp={handlePointerEnd}
    onPointerCancel={resetSwipe}
    className="relative z-10 w-full touch-pan-y rounded-card bg-surface-container p-5 text-left transition"
    style={{ transform: `translateX(${offsetX}px)` }}
  >
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {task.needs_review ? (
            <span className="inline-flex rounded-pill bg-primary/20 px-3 py-1 text-xs uppercase tracking-[0.18em] text-primary">
              Needs review
            </span>
          ) : null}
          {badge ? (
            <span className={`inline-flex rounded-pill px-3 py-1 text-xs uppercase tracking-[0.18em] ${badge.tone}`}>
              {badge.label}
            </span>
          ) : null}
        </div>
        <div className="space-y-2">
          <p className="font-display text-xl text-on-surface">{task.title}</p>
          <p className="font-body text-sm text-on-surface-variant">{task.group.name}</p>
        </div>
      </div>
      <div className="mt-1 rounded-pill bg-surface-container-high px-3 py-2 text-xs uppercase tracking-[0.18em] text-on-surface-variant">
        {task.due_bucket.replace('_', ' ')}
      </div>
    </div>
  </button>

  <div className="relative z-10 flex gap-3 border-t border-outline/15 bg-surface-container-high px-4 py-3">
    <button
      type="button"
      onClick={() => onComplete(task.id)}
      disabled={isBusy}
      className="rounded-pill bg-primary px-4 py-2 text-sm font-medium text-surface disabled:opacity-50"
      aria-label={`Complete ${task.title}`}
    >
      Complete
    </button>
    <button
      type="button"
      onClick={() => onDelete(task.id)}
      disabled={isBusy}
      className="rounded-pill border border-outline/30 px-4 py-2 text-sm text-on-surface-variant disabled:opacity-50"
      aria-label={`Delete ${task.title}`}
    >
      Delete
    </button>
  </div>
</article>

// After
<article className="relative overflow-hidden rounded-card bg-surface-container shadow-ambient">
  <div className="absolute inset-0 flex items-center justify-between px-3 text-xs uppercase tracking-[0.1em] text-on-surface-variant">
    <span>Swipe right to complete</span>
    <span>Swipe left to delete</span>
  </div>
  <button
    type="button"
    onClick={() => onOpen(task.id)}
    onPointerDown={handlePointerDown}
    onPointerMove={handlePointerMove}
    onPointerUp={handlePointerEnd}
    onPointerCancel={resetSwipe}
    className="relative z-10 w-full touch-pan-y rounded-card bg-surface-container p-3 text-left transition"
    style={{ transform: `translateX(${offsetX}px)` }}
  >
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {task.needs_review ? (
            <span className="inline-flex rounded-pill bg-primary/20 px-2 py-0.5 text-xs uppercase tracking-[0.1em] text-primary">
              Needs review
            </span>
          ) : null}
          {badge ? (
            <span className={`inline-flex rounded-pill px-2 py-0.5 text-xs uppercase tracking-[0.1em] ${badge.tone}`}>
              {badge.label}
            </span>
          ) : null}
        </div>
        <div className="space-y-1">
          <p className="font-display text-lg text-on-surface">{task.title}</p>
          <p className="font-body text-xs text-on-surface-variant">{task.group.name}</p>
        </div>
      </div>
      <div className="mt-0.5 rounded-pill bg-surface-container-high px-2 py-1 text-xs uppercase tracking-[0.1em] text-on-surface-variant">
        {task.due_bucket.replace('_', ' ')}
      </div>
    </div>
  </button>

  <div className="relative z-10 flex gap-2 border-t border-outline/15 bg-surface-container-high px-3 py-2">
    <button
      type="button"
      onClick={() => onComplete(task.id)}
      disabled={isBusy}
      className="rounded-pill bg-primary px-3 py-1.5 text-xs font-medium text-surface disabled:opacity-50"
      aria-label={`Complete ${task.title}`}
    >
      Complete
    </button>
    <button
      type="button"
      onClick={() => onDelete(task.id)}
      disabled={isBusy}
      className="rounded-pill border border-outline/30 px-3 py-1.5 text-xs text-on-surface-variant disabled:opacity-50"
      aria-label={`Delete ${task.title}`}
    >
      Delete
    </button>
  </div>
</article>
```

## Implementation Order

1. **AppShell.tsx** - Header & logo simplification (quick win, high impact)
2. **CaptureRoute.tsx** - Mic button enhancement (critical for UX)
3. **TasksRoute.tsx** - Task list tightening (high impact on daily use)
4. **TaskDetailRoute.tsx** - Form/input tightening
5. **ManageGroupsRoute.tsx** - Form/input tightening
6. **Global spacing adjustments** - Fine-tuning across all files

## Success Metrics

- [ ] Logo takes up < 50% of current vertical space
- [ ] Environment badge is compact and non-intrusive
- [ ] Mic button has clear icon and feels interactive
- [ ] Task list shows 2-3 more items on screen
- [ ] Overall UI feels tighter and more mobile-optimized
- [ ] No loss of functionality or accessibility

## Design System Alignment

All changes align with the existing design system documented in `docs/Design.md`:
- Maintains "Digital Void" aesthetic
- Uses existing color tokens and gradients
- Preserves "Glass & Gradient" rule for mic button
- Follows "No-Line" rule (no new borders added)
- Uses existing spacing scale where possible

## Notes

- All changes maintain backward compatibility
- No breaking changes to component APIs
- Accessibility attributes preserved
- Mobile-first approach prioritized
- Changes are incremental and can be reviewed individually
