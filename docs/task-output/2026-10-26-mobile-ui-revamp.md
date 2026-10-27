# Mobile UI Revamp: Light and Dark Themes, Bottom Sheets, One-Tap Capture

Date: 2026-10-26
Branch: `feat/mobile-ui-revamp` (not merged; awaiting owner testing)

## Goal

Rebuild the mobile UI to match two reference screens (dark navy + lavender, light sage + paper), default to light, make every mobile modal a bottom sheet about three quarters of the screen tall, move capture behind the + button, give unreviewed extracted tasks a home, and add a light theme to desktop without changing its layout or its dark look.

## What changed

**Theme system.** `styles.css` defines `light`, `dark`, and `classic` palettes as RGB-channel CSS variables; `tailwind.config.ts` maps them to tokens (plus chip pairs and shadow tokens) and enables a `dark:` variant on `[data-theme="dark"]`. `ThemeProvider` resolves Light/Dark/Auto, applies `data-theme` and the `theme-color` meta, and persists the choice. `useClassicDarkPalette` (desktop shell) swaps desktop dark to the original violet values.

**Primitives.** `components/ui/BottomSheet.tsx` (portal, enter/exit animation that keeps the last content during exit, drag-to-dismiss from the grabber or the top of the content, stacking with receding lower sheets, focus trap and restore, scroll lock, Escape for the top sheet only); `components/ui/controls.tsx` (`CheckCircle`, `Chip`, `Switch`, `SegmentedControl`, `SectionLabel`, `InlineNotice`, `EmptyState`); a rewritten `Button`.

**Shell.** `AppShell` now owns the capture controller and three URL-driven sheets (`useShellSheets`): capture, review, and account. Per-screen `ScreenHeader` (eyebrow, large title, refresh, review bell with badge). Bottom nav with a sliding indicator and an avatar that opens the account sheet (theme picker, completed tasks, settings, desktop mode, install, logout). Floating + button.

**Capture sheet** (`routes/capture/CaptureSheet.tsx`). Phases: compose (Speak/Type), recording (voice-level orb from an `AnalyserNode`, timer, Discard, Type instead), processing (rotating copy, skeletons), review (extracted cards, bulk approve/discard, "N more from earlier captures"). `useCaptureRecorder` gained `cancel()` and exposes the live stream. **Review sheet** groups every pending extracted task by capture.

**Screens.** Task home: date header, `WeekStrip` (`?day=` filter, backfills pages up to a cap), review banner, group pills/search, agenda sections (Today / Overdue / Upcoming / No date), timeline `OpenTaskCard` with swipe actions. Completed, Groups (add-group sheet), Settings (new Appearance card), task detail (dock), login, and session states restyled. Task preview, edit-extracted-task, delete, and restore are sheets.

**Desktop.** Hardcoded dark-only colors replaced with tokens; modal gradients kept under `dark:` so desktop dark is unchanged; theme toggle in the top bar.

**Robustness found on the way.** The shell now reads pending tasks on every screen, so malformed list payloads are normalized instead of crashing the app; groups load only while capture/review is open so the task detail page keeps its lazy group fetch; enter animations use `backwards` fill so no lingering transform traps `position: fixed` children (this had pushed the task detail dock off-screen).

## Verification

- `npm run lint`, `tsc`, `vite build`: pass. `vitest`: 205/205 (tests updated for the new markup, sheets, routes, and landing; new tests for the timeline card and swipe gestures).
- Manually checked in the in-app browser against the local Makefile stack at 320, 375, 768, and 1440 px wide, in light and dark: home, week strip, review banner, account/theme sheet, capture (type, mic-denied fallback, recording with a synthetic audio stream, transcription error), review sheet, stacked edit sheet, task preview, delete confirmation, groups, completed, settings, task detail, and desktop dashboard in both themes.
- Not verified: a real microphone recording end to end, and real extraction (the local stack has no OpenRouter key), and behaviour on a physical iPhone (safe areas, keyboard over sheets, Safari drag gestures).
- `fallow` fails its complexity gate on this branch (25 findings) as it does on `main` (14); its dead-code check now passes.

## Follow-ups

- Confirm auto-recording on + (the `/tasks` landing was confirmed by the owner).
- Test sheets with the iOS keyboard open and the drag-to-dismiss gesture on Safari.
- Consider splitting `BottomSheet`, `CaptureSheet`, and `TaskPreviewView` to bring complexity findings down.
