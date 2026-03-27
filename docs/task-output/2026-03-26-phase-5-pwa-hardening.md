# Task Output

## Task

Implement `P5-01`: finalize the PWA manifest, install flow, production icons, and app-shell-only service-worker caching.

## What Changed

- Updated the frontend PWA configuration to register the service worker from app code, ship explicit PNG icon assets, and keep Workbox runtime caching disabled.
- Tightened navigation fallback behavior so backend-style paths are denied from SPA fallback handling, reducing the chance of service-worker interference with authenticated API routes.
- Added a header-level install CTA in the app shell, iPhone install fallback guidance, and an explicit update banner that reloads only after the user chooses to apply a new service worker.
- Generated production PNG app icons for Android installs, maskable installs, and Apple touch icon support from the existing Gust SVG artwork.
- Updated the static HTML entrypoint to advertise the new PNG icons directly.
- Added frontend regression coverage for install prompt handling, installed-state hiding, iPhone fallback instructions, and update-banner reload behavior.

## Validation

- `cd frontend && npm run test`
- `cd frontend && npx vite build`

## Notes

- The service worker remains app-shell-only: precache covers static assets and there is no runtime caching for authenticated API responses or task data.
- `cd frontend && npm run build` still fails on pre-existing TypeScript `noUnusedLocals` errors outside this task's scope.
