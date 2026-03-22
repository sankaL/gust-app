# Frontend — Agent Guidance

Keep this file focused on **durable frontend engineering rules** for Gust. Do not add setup commands, ports, env-var instructions, or speculative file maps.

## Sources of Truth
- Product behavior: `docs/PRD-Gust.md`
- Frontend architecture and PWA constraints: `docs/Tech-Stack-Gust.md`
- Visual system and interaction direction: `docs/Design.md`
- When working on any UI, reference: `docs/ui-reference/*`

## Frontend Commitments
- Build for a **mobile-first, voice-first** task capture flow.
- The Capture screen is the primary launch experience.
- Voice input is primary; manual text input is a fallback and should remain visually secondary.
- Show transcript review before any task-creation write.
- Keep edited transcript state locally until submission succeeds or the user explicitly discards it.

## Architecture & State
- Follow the committed stack: React + TypeScript + Vite, React Router, TanStack Query, Tailwind CSS + CSS variables, and `vite-plugin-pwa`.
- Use URL state for navigation/filter state, local component state for transient interaction state, and TanStack Query for server-backed data.
- The frontend talks only to the backend API. Do not call the database, auth provider internals, transcription provider, extraction provider, or email provider directly from the client.
- Local testing should honor the repo's dev-mode environment flag and run against the Makefile-managed Docker stack rather than hosted production services.

## Auth & Network Rules
- Auth state comes from backend-managed session endpoints, not from reading tokens in the browser.
- Do not store auth tokens in `localStorage`, `sessionStorage`, or other JS-readable persistence.
- Missing or invalid session/config state must fail closed with user-safe UI.
- Mutation flows should preserve enough local state for retry when transcription or extraction fails.
- Do not connect frontend local testing to production Supabase Auth or the production Supabase database.

## Mobile UX & Reliability
- Optimize for large touch targets, short flows, and one-handed phone use.
- Microphone permission denial must leave text capture available and usable.
- If transcription or extraction fails, keep the transcript or draft visible so the user can retry or edit.
- Clean up recorder instances, media streams, listeners, intervals, and subscriptions on every path.
- Bound retries and polling; do not leave background loops running.

## Styling & PWA Constraints
- Follow `docs/Design.md`, not generic component-library defaults.
- Use Tailwind plus CSS variables/tokens for styling decisions; avoid ad-hoc visual systems.
- Preserve the dark, layered, voice-reactive visual language and mobile ergonomics described in the design doc.
- Service worker caching must be limited to app shell/static assets. Do **not** cache authenticated API responses or task data.
