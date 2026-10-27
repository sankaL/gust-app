# Design System Strategy: The Gust Minimalist

## 0. Theme System (2026-10 revamp)

The mobile app was redesigned around two palettes that share one component system. Light is the default.

| | Light ("Sage") | Dark ("Midnight") |
|---|---|---|
| Canvas | soft sage-gray `#ECF1ED` | navy `#12172B` |
| Cards | warm paper `#FDFDFA`, soft shadow, hairline ring | `#1E253E`, hairline ring |
| Accent | sage green `#4F7D66` (white on top) | lavender `#AC92FC` (deep indigo on top) |
| Ink | deep green-black `#1B2A22` | near-white `#F2F4FB` |
| Section labels | title case, bold display font | small uppercase, letter-spaced, muted |
| Selected day | outlined ring | filled accent circle |

Desktop keeps its existing layout; it gets the light palette, and its dark mode keeps the original violet "Digital Void" palette (`data-palette="classic"`). The public landing page stays on that palette.

**Tokens.** All colors are CSS variables (RGB channels) behind Tailwind names: `surface*`, `primary`, `on-primary`, `on-surface*`, `outline`, `card-active`, `nav`, `backdrop`, and chip pairs `chip-{neutral,blue,violet,amber,green,rose}` / `-ink`, and `on-tertiary` (ink for the review badge; dark in Midnight so the count stays readable on pink). Shadows are tokens too (`shadow-card`, `shadow-float`, `shadow-sheet`), and clay surfaces read `--clay-hi`, `--clay-lo`, `--clay-drop` per palette. Hardcoded hex/rgba values are not allowed in components.

**Surfaces (2026-10).** The chrome that floats over tasks uses two materials, picked from the Gust Surface Lab comparison:
- **Clay** for the bottom nav and its + capture button. It is the `.clay` rule from clay.css (Adrian Bece, MIT), copied into `styles.css` and fed Gust tokens through modifiers: `clay-nav`, `clay-capture` (the +, ink colored so it reads apart from the accent active tab) and `clay-accent-sm` (the active tab). Clay is plain box-shadow, so it renders the same on every browser.
- **Liquid glass** for bottom sheets (`liquid-sheet`: a 12px blur over a 55-60% tint, so the list shows through but text stays readable) and the review bell (`liquid-lens`, a clear lens with a `lens-bead` badge). Both get a specular rim and a `.liquid-warp` backdrop layer. `useGlassRefraction` adds an SVG edge-refraction filter sized to the surface (sheets measure themselves through `MeasuredGlassWarp`) in Chromium only. WebKit (every iOS browser and the installed iPhone PWA) and Gecko ignore SVG filters on backdrops, so there the surfaces stay clear frosted glass with the rim. The sheet backdrop scrim is a light 20% tint without blur so the glass has something to show.

**Shared primitives** (`frontend/src/components/ui/`, `Button.tsx`):
- `BottomSheet` — every mobile modal. Default height is 75% of the viewport (`size="auto"` for short confirmations). Drag the grabber or pull down from the top of the content to dismiss; backdrop tap and Escape also close. Stacked sheets recede (scale 0.94) under the one on top. Focus is trapped and restored; page scroll is locked.
- `CheckCircle` — the only check control: completing tasks, approving extracted tasks, toggling subtasks. The ring fills with the accent and the check draws in.
- `Chip` — metadata pills; groups get a stable color derived from their name.
- `Button` (primary / secondary / ghost / danger / soft), `Switch`, `SegmentedControl`, `SectionLabel`, `InlineNotice`, `EmptyState`.

**Mobile layout.** Screen header = eyebrow + large date/title + round action buttons (refresh, review bell with count). The task home adds a 7-day strip (today selected; other days filter the agenda) and agenda sections Today / Overdue / Upcoming / No date. Task cards follow the reference timeline: a time column (reminder time, else due date) with a fading rule, then title, two-line description, and chips; the check sits top-right. Swipe right completes, swipe left deletes. A floating clay pill nav sits above the home indicator with five slots: Tasks, Completed, a raised ink-colored + for capture in the center, Groups, and a user icon that opens the account sheet. A sliding accent clay indicator marks the active tab.

**Motion.** Sheets slide on `cubic-bezier(0.32, 0.72, 0, 1)` (~520 ms in, 360 ms out). Lists rise in with a 45 ms stagger; route changes fade up. The capture orb breathes when idle, and its aura scales with live microphone level while recording. Enter animations use `animation-fill-mode: backwards` so no transform lingers (a leftover transform breaks `position: fixed` children). `prefers-reduced-motion` collapses all of it.

The sections below describe the original dark direction; where they conflict with this section (for example the "No-Line" rule — the revamp uses low-opacity hairline rings), this section wins.

## 1. Overview & Creative North Star
The Creative North Star for this design system is **"The Digital Void."**

Unlike traditional "dark mode" apps that merely invert a white UI, this system treats the screen as a limitless, obsidian space where information floats and pulses. We are moving away from the "boxy" constraints of early mobile design. By utilizing intentional asymmetry, expansive negative space, and a high-contrast typography scale, we create an experience that feels less like a utility and more like a premium high-tech instrument.

The focus is on "Voice-First" ergonomics. The interface should feel like it is listening, using breathing gradients and layered depth to provide a haptic-visual response to user input.

---

## 2. Colors: Tonal Depth & The "No-Line" Rule
This system relies on the interplay of deep charcoals and electric violets to guide the eye.

### The "No-Line" Rule
**Explicit Instruction:** Designers are prohibited from using 1px solid borders to section content. Boundaries must be defined solely through background color shifts. For example, a task list item (`surface_container_low`) should sit on a `surface` background. If you feel the need for a line, use a `3.5` (1.2rem) vertical spacer instead.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers—like stacked sheets of obsidian glass.
* **Base:** `surface` (#0e0e0e) for the primary application background.
* **Primary Containers:** Use `surface_container` (#1a1a1a) for the main task cards.
* **Nested Elements:** Use `surface_container_high` (#20201f) for interactive elements within cards, such as tags or time-stamps.

### The "Glass & Gradient" Rule
To elevate the "high-tech" vibe, use Glassmorphism for floating action buttons (FABs) and modals.
* **Voice Mic Button:** Apply a gradient transitioning from `primary` (#ba9eff) to `primary_dim` (#8455ef).
* **Floating Elements:** Use `surface_variant` at 60% opacity with a `24px` backdrop blur to create a "frosted glass" effect that allows background content to bleed through softly.

---

## 3. Typography: Editorial Authority
We utilize a pairing of **Manrope** for high-impact displays and **Inter** for functional reading. This creates an "Editorial Tech" feel.

* **Display-LG (Manrope, 3.5rem):** Use for "empty state" greetings or large time displays. It should feel massive and confident.
* **Headline-MD (Manrope, 1.75rem):** Used for category titles (e.g., "Work," "Personal").
* **Body-LG (Inter, 1rem):** The primary font for task descriptions. Inter’s high x-height ensures readability against high-contrast backgrounds.
* **Label-MD (Inter, 0.75rem):** Reserved for metadata like "Due in 2 hours."

**Hierarchy Strategy:** Use `on_surface` (#ffffff) for active tasks and `on_surface_variant` (#adaaaa) for completed or secondary information to create a natural "fade" without changing font sizes.

---

## 4. Elevation & Depth: Tonal Layering
In the "Digital Void," shadows represent ambient light from the accent colors, not darkness.

* **The Layering Principle:** Achieve lift by stacking. A `surface_container_highest` (#262626) card placed on a `surface_dim` (#0e0e0e) background provides sufficient contrast without artificial styling.
* **Ambient Shadows:** For floating elements, use a shadow with a 40px blur, 0px offset, and 6% opacity. Use a tinted shadow color derived from `primary_dim` to simulate the glow of the screen's "electric violet" pulse.
* **The "Ghost Border" Fallback:** If a border is required for accessibility, use `outline_variant` (#484847) at **15% opacity**. It should be felt, not seen.

---

## 5. Components: The Primitive Set

### The Pulsing Mic (Primary Action)
* **Shape:** `full` (9999px) roundedness.
* **Color:** Gradient of `primary` to `primary_dim`.
* **Interaction:** On tap, use a `surface_tint` (#ba9eff) outer glow to indicate the "listening" state.

### Task Cards & Lists
* **Styling:** Use `surface_container` (#1a1a1a) with `DEFAULT` (1rem) roundedness.
* **Layout:** Forbid divider lines. Use `spacing.4` (1.4rem) between cards to create distinction.
* **Leading Element:** Use high-contrast badges for due dates using `tertiary_container` (#fd81a8) with `on_tertiary_container` (#59002a) text.

### Mobile Task Search
* Place the icon-only search control before `All` in the mobile group row and give it a 40px touch target plus an accessible label and tooltip.
* Opening search replaces the row with one full-width field. Cross-fade and shift the two states over 200ms, but remove the motion when the user requests reduced motion.
* Keep the search icon as the field's leading anchor and place a clear control at the trailing edge. Clearing or pressing Escape restores the group row and focus to the search icon.
* While a request is pending, keep the current task layout in place, mark it busy, and lower its opacity. Search errors must use fixed user-safe copy and leave the query available for retry.

### Input Fields
* **Styling:** Background-less. Only a bottom "Ghost Border" using `outline_variant` at 20% opacity.
* **Focus State:** The border transitions to a `primary` (#ba9eff) glow.

### Voice Visualization (Additional Component)
* A custom component for this app: An asynchronous waveform utilizing `primary`, `secondary`, and `tertiary` tokens. These represent the "Voice Todo" being processed, replacing a standard loading spinner.

---

## 6. Do's and Don'ts

### Do
* **DO** use white space as a structural element. If a screen feels cluttered, increase spacing from `spacing.4` to `spacing.6`.
* **DO** use `surface_bright` (#2c2c2c) for "Press" states on cards to provide immediate tactile feedback.
* **DO** lean into asymmetry. Align headings to the far left with a generous `spacing.10` top margin.

### Don't
* **DON'T** use pure black (#000000) for anything other than `surface_container_lowest`. It kills the depth of the "Void."
* **DON'T** use standard "checkboxes." Instead, use custom-styled circular toggles that fill with `primary` color when completed.

### Notification Settings

Notification settings use grouped tonal cards, 44px minimum toggle rows, explicit saved/error feedback, and accessible names/states. Pushover child controls remain visible but disabled until a connected master switch is enabled; the manual-key fallback is disclosed progressively so the primary connection path remains low-friction.
* **DON'T** use 90-degree corners. Everything must have a minimum roundedness of `sm` (0.5rem) to maintain the "approachable" vibe.

---

## 7. Spacing Scale
| Token | Value | Use Case |
| :--- | :--- | :--- |
| **0.5** | 0.175rem | Icon internal details |
| **2** | 0.7rem | Text to Badge padding |
| **4** | 1.4rem | Standard Card padding |
| **8** | 2.75rem | Section spacing |
| **16** | 5.5rem | Extreme top margins for Headlines |
