# Design System Strategy: The Sonic Minimalist

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