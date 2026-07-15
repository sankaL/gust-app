# Task Output: Cross-Stack Code Quality Remediation

## Date and Scope

- Date: 2026-07-14
- Branch: `codex/security-hardening`
- Baseline commit: `6c3a303`
- Scope: all remaining frontend Fallow findings, lint and production-build warnings, backend complexity and modernization findings, test determinism, dependency warnings, quality gates, and an independent review of the complete follow-up diff
- Production deployment was not performed.

## Executive Result

The remaining static-analysis backlog is cleared without suppressing findings or relaxing thresholds. Coverage-aware Fallow now reports zero dead-code issues, zero duplicate groups, zero complexity findings, and zero security candidates. Its strict changed-file audit passes with `--gate all`. Frontend lint has zero warnings, the production build no longer emits the large-chunk warning, expanded backend Ruff checks have zero findings, and both complete test suites pass.

The refactor preserved the existing product and security contracts while moving large route/modal implementations into focused controllers, views, hooks, and presentation components. Router-level lazy loading reduced the initial production JavaScript entry from roughly 746 KB to 374.4 KB.

## Identified and Fixed

| Area | Identified | Fixed |
|---|---|---|
| Frontend complexity | 49 functions exceeded Fallow's default cyclomatic, cognitive, or coverage-aware CRAP thresholds. | Decomposed route orchestration, task preview/detail flows, capture state, desktop dashboards/tables, forms, pickers, shell state, and optimistic cache mutations into focused units. Final count: 0. |
| Frontend duplication | 27 clone groups remained after the security pass. | Extracted shared task-form sections, recurrence fields, query/cache flows, task rows, route views, shell layouts, and modal behavior. Final groups and duplicated lines: 0. |
| Frontend dead code | The prior pass had already reached zero, but derived prop types created transient scanner false positives during refactoring. | Replaced ambiguous derived child prop contracts with explicit contracts. Final dead-code and component-prop findings: 0. |
| Frontend lint | Three hook-dependency warnings remained, and lint allowed warnings. | Stabilized floating overlay callbacks/refs and changed the lint command to `--max-warnings 0`. Final warnings: 0. |
| Frontend bundle | The initial 746 KB entry bundle exceeded Vite's 500 KB warning threshold. | Added router-level lazy loading for shells and routes. Final initial entry: 374.4 KB; no chunk warning. |
| Backend complexity | Expanded Ruff analysis found 36 C90/SIM/import/upgrade findings, including six C901 service/repository hotspots. | Split repository filtering/pagination, capture preparation/submission, extraction parsing/execution, staging normalization, and recurrence validation into cohesive helpers. Final expanded Ruff findings: 0. |
| Python modernization | Sixteen files used broad upgrade-rule suppressions even though the runtime is pinned to Python 3.12. | Converted 107 legacy optional/union annotations, removed the obsolete file-wide suppressions, and aligned Ruff's target with Python 3.12. |
| Backend warnings | Tests relied on deprecated implicit SQLite date adapters, the transitional HTTPX test client, deprecated 422 names, and legacy Alembic path parsing. | Registered explicit test adapters, added `httpx2`, used Starlette's current test client, updated the 422 constant, and configured Alembic's path separator. Final backend suite emits no warnings. |
| Test isolation | A voice rate-limit test could reach the configured extraction provider; a lazy landing-route assertion raced under the parallel coverage suite; one test used an arbitrary sleep outside React `act`. | Injected a fake extractor, gave lazy imports an explicit bounded assertion timeout, and removed the sleep. Full suites are deterministic and provider-free. |
| Quality gates | Fallow was an ad-hoc report and cached scans could conceal coverage changes. | Added a no-cache `quality:fallow` script, made coverage plus strict Fallow part of `make check`, and made frontend lint fail on warnings. |

## Final Fallow Results

Raw reports are stored in `docs/engineering/`.

| Surface | Security-remediation baseline | Final |
|---|---:|---:|
| Dead-code issues | 0 | 0 |
| Duplicate groups | 27 | 0 |
| Duplicated lines | 585 | 0 |
| Complexity findings | 49 | 0 |
| Security candidates | 0 | 0 |
| Strict changed-file audit | fail | pass (`--gate all`, Istanbul coverage) |
| Average maintainability | 91.0 | 87.4 (good; newly extracted units and full source inventory change the aggregate) |

The final health model analyzed 1,479 functions across 113 files, matched Istanbul coverage for 1,481 of 1,921 coverage functions, and found no critical, high, or moderate threshold violations. Fallow's security graph reports zero candidates and zero unresolved-edge files; 692 dynamic callee sites remain a documented static-call-graph limitation.

## Validation

- Frontend: ESLint passed with zero warnings; 152/152 Vitest tests passed with Istanbul coverage; TypeScript and Vite production build passed; PWA generation completed; no large-chunk warning.
- Backend: Ruff passed with `E,F,I,B,UP,N,C90,SIM`; 211/211 pytest tests passed with no warnings; smoke import passed.
- Dependencies: `npm audit` found zero vulnerabilities; `pip-audit` found zero vulnerabilities across 71 auditable dependencies (the local `gust-backend` package is not published to PyPI and is therefore skipped).
- Fallow 3.5.0: combined no-cache gate passed with zero dead code, duplicates, and complexity findings; security candidates: 0; strict audit verdict: pass.
- Repository hygiene: `git diff --check` passed before review.

## Deferred

- Fallow still emits advisory refactoring targets based on churn and fan-in even though none exceed a configured health threshold. They are navigation/prioritization hints, not failing findings; further splitting should be driven by a concrete behavior change rather than file-count reduction alone.
- `backend/app/prompts/extraction_prompts.py` retains its existing file-level E501 exception. The long lines are literal model instructions and examples whose whitespace is part of the prompt contract; executable Python remains under the normal line-length rule.
- Browser end-to-end coverage and a local two-user Postgres/RLS test would add confidence beyond the unit/integration/static coverage completed here.

## Needs User Input or Operational Action

No additional code-quality decision is required. The production/security actions from the main security report still apply: schedule migration `0016_harden_rls_relationships`, choose whether to add an edge WAF/rate limiter, and decide whether internal jobs should receive a separate database role.

## Confidence

Confidence is 98%. Confidence would increase after the existing security rollout preflight succeeds against production-like Postgres data and browser end-to-end tests exercise desktop task editing, route chunk loading, and two-user data isolation.
