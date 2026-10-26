# Capture Latency: Voxtral Transcription and Claude Haiku 5.5 Extraction

Date: 2026-10-26

## Why

Production logs from 2026-10-24 (AssemblyAI + Gemini 3.8 Flash) showed, for a 10-word voice capture:

| Stage | Time |
|---|---|
| Auth plus DB work before transcription | ~0.7 s |
| `capture.transcription` (AssemblyAI upload, submit, 1 s polling, delete) | 3.4 s |
| DB work between transcription and extraction | ~0.7 s |
| `capture.extraction` (Gemini 3.8 Flash) | 5.4 s |
| `request.total` | 10.5 s |
| Client follow-up `GET /captures/{id}/extracted-tasks` | ~0.5 s |

With inputs that short, the cost was fixed overhead: provider round trips, hidden medium-effort reasoning, and a written-out two-pass enumeration, not transcript length.

## What changed

**Transcription.** `MistralTranscriptionService` sends one multipart request to Mistral (`voxtral-mini-2602`, Voxtral Mini Transcribe V2). Error mapping: 401/403 or `invalid_model` → `config_invalid`; 402 or a billing/credit message → `ai_service_quota_exceeded`; 429/5xx → provider unavailable; other 4xx → provider rejected; empty text → no speech.

**Extraction.** `ClaudeExtractionService` calls `claude-haiku-5-5` through the `anthropic` SDK with:
- `thinking: disabled`, `output_config.effort: low`
- a JSON schema built from a compact wire model (`_WirePayload`): optional fields may be omitted, groups are referenced by name, and subtasks are plain strings
- a static, cached system prompt (`cache_control: ephemeral`) with rules plus three short examples; no two-pass enumeration
- no `temperature`/`top_p`/`top_k` (rejected by current Claude models)

Wire output is mapped back to `ExtractorPayload` (group names → ids, confidences clamped), so staging and guardrails are unchanged. Refusals raise `ExtractionRefusedError` and are not retried; `max_tokens` truncation or schema mismatch raise `ExtractorMalformedResponseError`, which gets the single payload retry in `CaptureService`.

**Retries.** Removed `ExtractionRetryManager` (3 attempts with backoff) and the OpenRouter A/B model registry. Bounds are now: one SDK transport retry, one payload retry, and the existing corrective guardrail pass.

**Pipeline.** `app/services/ai_clients.py` opens one `httpx.AsyncClient` (Mistral) and one `AsyncAnthropic` client in the FastAPI lifespan and closes them on shutdown. In `CaptureService`:
- **Voice:** the capture-row insert and the group/timezone load run while Mistral transcribes, and the transcript write runs while Claude extracts.
- **Text and re-extract:** the capture write and the context load run side by side.

Responses from `POST /captures/voice`, `POST /captures/text`, and `POST /captures/{id}/re-extract` include the staged tasks. The frontend seeds `['extracted-tasks', captureId]` from them, so review renders without another request.

**Observability.** `extraction_completed` logs model, stop reason, latency, and input/output/cache token counts, but never transcript or output text. Stages in `server_timing`: `capture.context`, `capture.transcription`, `capture.extraction`, `capture.staging`.

**Dependencies.** Added `anthropic>=2.3.0`; removed `langchain`, `langchain-core`, `langchain-openai`, and the `ab-testing` extra.

## Configuration

- New: `MISTRAL_API_URL`, `MISTRAL_API_KEY`, `MISTRAL_TRANSCRIPTION_MODEL` (default `voxtral-mini-2602`), `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL` (optional), `EXTRACTION_MODEL` (default `claude-haiku-5-5`), `EXTRACTION_MAX_OUTPUT_TOKENS` (default 2048).
- Changed defaults: `TRANSCRIPTION_TIMEOUT_SECONDS` 30 → 20, `EXTRACTION_TIMEOUT_SECONDS` 20 → 10.
- Removed (now ignored): `ASSEMBLYAI_*`, `OPENROUTER_*`, `EXTRACTION_MAX_RETRIES`, `EXTRACTION_RETRY_*`, `EXTRACTION_MODEL_CONFIG_PATH`, `EXTRACTION_AB_TEST_ENABLED`.

## Verification

- **Backend:** 268 tests ran; 267 pass. The one failure, `test_rotate_pushover_credentials.py::test_previous_keys_setting_parses_csv`, fails identically at HEAD because it does not set `APP_ENV`. New tests:
  - Mistral request shape, error mapping, and client reuse
  - Claude request body (thinking off, low effort, schema, cached system prompt, no sampling params)
  - group-name mapping and account-error classification
  - refusal, truncation, and schema-mismatch handling
  - log redaction
  - prompt examples validated against the wire schema
  - capture responses carrying staged tasks
- **Frontend:** typecheck, lint, and the full vitest suite pass. A new test confirms voice review renders from the response without fetching extracted tasks.
- **Not verified against live providers:** no Mistral or Anthropic key is available locally or in Railway yet, so the latency gain and extraction quality are unmeasured.

## Expected latency (unmeasured)

- Transcription: roughly 0.5–1.5 s for a short clip, versus 3.4 s.
- Extraction: roughly 0.5–1 s for one task, longer as the task count grows, versus 5.4 s.
- Overall: the overlapped DB work and the dropped follow-up GET remove about 1 s more.

## Known limits / follow-ups

- The 0.5 s extraction target is plausible only for short, single-task captures; output tokens dominate the rest.
- **Out of scope here:**
  - `get_auth_service` builds a new `PyJWKClient` per request, likely re-fetching JWKS each time.
  - Synchronous SQLAlchemy calls still block the event loop.
  - The staging path routes by confidence differently from the PRD (0.7 review threshold, no tie or below-0.5 Inbox rule).
- Voxtral Mini Transcribe 3 is now available and worth an A/B comparison.
