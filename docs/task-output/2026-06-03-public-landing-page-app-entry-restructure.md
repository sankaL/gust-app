# Task Output: Public Landing Page and App Entry Restructure

## Date

- 2026-06-03

## Summary

- Added a public landing page at `/` for Gust.
- Moved the protected mobile app entry from `/` to `/capture`.
- Kept `/login` as the dedicated auth route and `/desktop` as the protected desktop workspace.
- Updated the PWA launch entry so installed Gust still opens directly into capture.

## Implemented Behavior

- Public landing page:
  - Added a dedicated `LandingRoute` instead of reusing the protected app shell.
  - Adapted the provided cinematic hero structure to Gust branding, copy, and color tokens.
  - Added `Request access` (`mailto:admingust@gmail.com`) and `Log in` (`/login`) CTAs.
  - Used `gsap` plus `ScrollTrigger` for the landing sequence while preserving readable content when the animation timeline does not run.
- Authenticated route contract:
  - `/capture` now renders the protected mobile capture experience.
  - `/tasks`, `/tasks/completed`, `/tasks/groups`, and related mobile task routes remain protected.
  - `/login` now defaults successful sign-in to `/capture`.
  - `/desktop` remains protected, with phone-class redirects now pointing to `/capture` instead of `/`.
- Shell navigation and device routing:
  - Updated mobile and desktop shell links that previously treated `/` as the capture entry.
  - Preserved the device-routing override behavior while changing the mobile destination to `/capture`.
- PWA:
  - Changed the manifest `start_url` to `/capture`.
  - Kept manifest `scope` at `/` so the landing page and installed app share the same origin scope.

## Validation Scope

- Frontend focused regression suites passed:
  - `src/test/app.test.tsx`
  - `src/test/device.test.tsx`
  - `src/test/capture.test.tsx`
  - `src/test/capture.pending-dedup.test.tsx`
- Production frontend build passed.

## Notes

- No backend API changes were required.
- No schema migration was required.
- Existing historical docs that describe the earlier mobile-at-`/` contract are superseded by the 2026-06-03 decision-log entry in `docs/decisions-made/decisions-made-1.md`.
