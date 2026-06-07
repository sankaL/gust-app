# Fallow Remediation Plan

Source report: `docs/engineering/fallow-output-20260607134941.json`  
Calibrated report: `docs/engineering/fallow-output-calibrated-202606071407.json`  
Generated: 2026-06-07 14:07 EDT  
Fallow version: 2.89.0

## Recommendation

Address the extracted-task edit/update logic first.

The best first bundle is to extract and test shared task-edit domain helpers used by `EditExtractedTaskModal`, `DesktopEditExtractedTaskModal`, `TaskForm`, and related recurrence form code. This hits the highest-risk findings with relatively contained code movement:

- `frontend/src/components/EditExtractedTaskModal.tsx` `handleSave`: CRAP 784.6, cognitive 90, partial coverage.
- `frontend/src/components/DesktopEditExtractedTaskModal.tsx` `buildUpdates`: CRAP 590.0, cognitive 54, partial coverage.
- `frontend/src/components/TaskForm.tsx` `handleSubmit`: CRAP 126.5, partial coverage.
- Repeated recurrence/update logic appears across mobile edit, desktop edit, task form fields, and preview flows.

This is higher value than deleting dead files first because it reduces risk in a real user workflow: captured task review/editing. It is lower effort than splitting the largest route components because most of the risky logic is pure data normalization and validation that can be extracted behind focused tests.

## Report Snapshot

- Dependency/import check issues: 13 total.
- Health findings: 49 total; 10 critical, 10 high, 29 moderate.
- Duplication: 3,811 duplicated lines out of 22,007 lines, about 17.3%.
- Backend/import hygiene appears clean in this report; the actionable findings are frontend-heavy.
- Fallow health targets identify six priority files: `EditExtractedTaskModal.tsx`, `TaskDetailRoute.tsx`, `CaptureRoute.tsx`, `DesktopTaskDetailModal.tsx`, `TaskPreviewModal.tsx`, and `DesktopEditExtractedTaskModal.tsx`.

## Calibrated Run Results

After adding `.fallowrc.json` with the Vite/Vitest entrypoints, a fresh no-cache run produced:

- Dependency/import check issues: 12 total.
- Unused files: 2, down from 3. `frontend/src/test/setup.ts` is no longer reported.
- Unused exports: 8, unchanged.
- Unused exported types: 2, unchanged.
- Health findings: 49 total; 10 critical, 10 high, 29 moderate, unchanged.
- Duplication: 3,811 duplicated lines out of 22,007 lines, about 17.3%, unchanged.

The calibrated run warned that `node_modules` was not present from the repo root. Treat dependency-resolution findings as directionally useful until dependencies are installed, but the code-level complexity and duplication findings remain useful.

## Critique Of The Findings

Some findings are valid and worth fixing. The high-CRAP partial-coverage functions in edit/update paths are real risk because they combine user input normalization, recurrence semantics, subtask handling, date conversion, network calls, and cache/update callbacks.

Some findings should be corrected or deprioritized:

- `frontend/src/test/setup.ts` is not an unused file. It is referenced by `frontend/vite.config.ts` through `setupFiles`. Treat this as a Fallow configuration or entrypoint-detection false positive.
- The 258-line duplicate group between `EditExtractedTaskModal.tsx` and `TaskForm.tsx` is low signal. Those files are structurally related, but the right fix is shared helpers and clearer component ownership, not merging the modal and form.
- Large React component complexity is not automatically a bug. For `CaptureRoute`, `TaskDetailRoute`, `TaskPreviewModal`, and `DesktopTaskDetailModal`, extract side-effect and domain logic first; split JSX only where it creates a stable ownership boundary.
- Test duplication is real but less urgent than production edit/capture logic. Consolidate repeated fetch mocks and render setup where it improves readability, but avoid building a heavy test abstraction layer.
- Unused exports in `api.ts`, `desktopData.ts`, and `taskQueryCache.ts` are probably internal cleanup, not product bugs. Remove or de-export them after confirming no planned near-term feature still needs them.

## Phase 1: Highest Value, Lowest Effort

Goal: Reduce noisy findings and the riskiest partial-coverage edit logic without changing user-visible behavior.

| Bundle | Findings Covered | Plan | Notes |
|---|---:|---|---|
| 1. Shared task-edit/update helpers | Critical CRAP in `EditExtractedTaskModal.handleSave`, `DesktopEditExtractedTaskModal.buildUpdates`, `TaskForm.handleSubmit`; recurrence duplication | Create a small frontend helper module for task form validation, recurrence normalization, subtask-title normalization, and extracted-task update diffing. Move pure logic out of modal submit handlers and cover it with focused tests. | Do this first. It preserves UI while reducing the highest-risk logic. |
| 2. Unused file/export triage | 3 unused files, 8 unused exports, 2 unused exported types | Delete confirmed-stale `DesktopModeRoute.tsx`. Delete or intentionally preserve `ExpandableTranscript.tsx` after checking whether the old staging plan still matters. Keep `test/setup.ts` and add Fallow config/suppression if available. De-export `ButtonProps` and `NotificationRecord` if they remain internal. Remove or internalize unused API/cache exports. | Expect some findings to disappear and one false positive to be documented rather than "fixed." |
| 3. Test fixture/fetch-mock consolidation | Largest duplicate families in `tasks.test.tsx`, `app.test.tsx`, `capture.test.tsx`, `capture.pending-dedup.test.tsx` | Extract shared test utilities for repeated fetch response routing, session/group/task fixtures, and render setup. Keep helpers explicit and local to `frontend/src/test` so test intent remains readable. | Good cleanup with low product risk. It also reduces complexity findings on test-local `fetchMock` functions. |

Expected outcome:

- The first issue addressed should be Bundle 1.
- The dependency/import check should drop from 13 issues to near-zero, except for intentional suppressions.
- The highest partial-coverage CRAP findings should be materially reduced or covered by focused tests.
- Future Fallow reports should be less noisy because known false positives are suppressed or configured once.

## Phase 2: Medium Effort, Medium/High Value

Goal: Untangle user-facing route and modal complexity after the shared helpers exist.

| Bundle | Findings Covered | Plan | Notes |
|---|---:|---|---|
| 4. Capture route orchestration split | `CaptureRoute` cognitive 58, 756-line function; `DesktopCaptureRoute` CRAP 240 with no coverage | Extract recording lifecycle, wake-lock handling, transcript review state, and capture submission/retry behavior into named hooks or utilities. Add regression coverage around cleanup of recorders, streams, listeners, and wake locks. | High product importance. Higher risk than Phase 1 because it touches the primary launch flow. |
| 5. Task detail and preview modal split | `TaskDetailRoute`, `TaskPreviewModal`, `DesktopTaskDetailModal` critical complexity | Share mutation/cache helpers, recurrence date helpers, and subtask action helpers. Then split stable render sections such as header, schedule fields, subtasks, footer actions, and delete/complete affordances. | Avoid a "component explosion"; split around behavior and repeated sections. |
| 6. Desktop task table/data cleanup | `desktopData.filterDesktopTasks`, `DesktopTaskTable`, desktop completed/tasks route duplicates | Replace long filter chains with named predicates, test filter/sort semantics, and extract shared desktop list-page scaffolding for `DesktopCompletedRoute`, `DesktopTasksRoute`, and `DesktopGroupDetailRoute` where it naturally fits. | This should improve desktop iteration speed without changing task semantics. |
| 7. Open task card decomposition | `OpenTaskCardInner` CRAP 184.5, partial coverage | Split date/status presentation, group/review badges, action controls, and memoized derived labels. Add focused tests for due buckets, recurrence/subtask display, and action callbacks. | User-visible, so keep styling snapshots/manual checks in mind. |

Expected outcome:

- Fallow critical/high health findings should fall sharply.
- Capture/task detail behavior should be easier to test and safer to change.
- Shared task semantics should live in helpers, not inside route components.

## Phase 3: Lower Priority Cleanup

Goal: Clean remaining duplication and moderate complexity opportunistically.

| Bundle | Findings Covered | Plan | Notes |
|---|---:|---|---|
| 8. Shell and notification polish | `AppShell`, `DesktopShell`, `Notifications`, `SelectDropdown` moderate/high complexity | Extract only repeated, stable utilities such as key handling, swipe state calculation, and shared shell menu data. Add tests for keyboard/screen-reader behavior where practical. | Useful, but less urgent than capture/edit flows. |
| 9. Remaining test duplication | Smaller clone groups in individual test files | Consolidate only when helpers make tests shorter and clearer. Leave intentional scenario-local duplication alone or suppress it. | Do not over-abstract tests just to satisfy a metric. |
| 10. Moderate component splits | `CompletedTasksRoute`, `StagingTable`, `ExtractedTaskCard`, `TaskFormFields`, and other moderate findings | Address when touching those surfaces for feature work. Extract pure helpers first, visual subcomponents second. | These are reasonable cleanup targets, not immediate blockers. |
| 11. Intentional suppressions | Low-signal clone/complexity findings after refactors | Add narrow Fallow suppressions with a short reason only after confirming the duplication or complexity is intentional. | Suppression is acceptable when it prevents recurring noise and captures intent. |

Expected outcome:

- Remaining Fallow findings are either real backlog items or documented intentional exceptions.
- Cleanup stays aligned with product work rather than becoming a metrics-only refactor.

## Validation Strategy

For each bundle:

- Re-run Fallow and compare against this source report.
- Run the relevant frontend type/lint/test checks through the repo's normal Makefile or package entrypoints.
- For capture, task edit, preview, and desktop table changes, use targeted regression tests plus a quick UI smoke check.
- Do not update product/schema docs unless behavior changes. Pure refactors and dead-code cleanup should not require PRD, schema, or migration-runbook updates.

## Confidence

Confidence: 84%.

Confidence would increase with:

- A fresh Fallow run after any local config changes, especially to confirm `test/setup.ts` handling.
- Confirmation from product/design whether `ExpandableTranscript.tsx` is intentionally reserved for a near-term transcript re-extraction workflow.
- Coverage data from the actual frontend test runner rather than Fallow's estimated coverage tiers.
