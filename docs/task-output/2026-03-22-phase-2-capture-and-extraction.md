# Task Output

## Task

Implement Phase 2: Capture and Extraction.

## What Changed

- Replaced the placeholder capture backend with authenticated `POST /captures/voice`, `POST /captures/text`, and `POST /captures/{capture_id}/submit` endpoints backed by a capture orchestration service.
- Added provider client seams for Mistral transcription and OpenRouter extraction, plus typed extraction payload models, bounded malformed-payload retry behavior, sanitized failure handling, and explicit capture status transitions.
- Expanded the repository layer to persist capture attempts, tasks, subtasks, and reminder rows with explicit user scoping and capture result counts.
- Added the `0003_phase2_capture_extraction` Alembic revision and introduced `tasks.reminder_at` as the canonical task-level reminder timestamp while retaining `reminder_offset_minutes` for recurrence inheritance.
- Rebuilt the frontend Capture route into a mobile-first signed-in flow with microphone recording, permission fallback, separate review for voice and text, same-recording retry, extraction summary cards, and local edit preservation across failures.
- Added backend tests for capture auth/CSRF, transcription and extraction failure handling, retry behavior, routing, reminder persistence, and user scoping, plus frontend tests for permission denial, separate text review, preserved edits on extraction failure, and same-recording retry.

## Validation

- `cd backend && .venv/bin/ruff check app tests`
- `cd backend && .venv/bin/pytest -q tests/test_captures.py tests/test_routes.py tests/test_migrations.py tests/test_repositories.py`
- `cd frontend && npm run lint`
- `cd frontend && npm test`
- `cd frontend && npm run build`

## Follow-Up Needed

- Phase 3 should replace the placeholder Tasks and Groups routes with real CRUD/listing behavior so the new capture summary can link into live task data instead of the current shell.
- Phase 4 should consume the Phase 2-created pending reminder rows with the reminder worker and recurrence generation flows.
