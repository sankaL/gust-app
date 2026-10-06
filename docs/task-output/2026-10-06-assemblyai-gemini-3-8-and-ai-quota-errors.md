# AssemblyAI Transcription, Gemini 3.8 Flash Extraction, and AI Quota Errors

Date: 2026-10-06

## Summary

- Transcription now uses AssemblyAI's pre-recorded API (`AssemblyAITranscriptionService`) with Universal-3.5 Pro and Universal-2 fallback. Universal-3.6 Pro was requested but is streaming-only.
- Extraction defaults to OpenRouter `google/gemini-3.8-flash`.
- Exhausted AI credits now produce a user-facing "contact the administrator" message instead of a generic failure or a silent empty extraction.

## Behavior

| Provider signal | Internal classification | API error | User sees |
|---|---|---|---|
| AssemblyAI 400 "balance is negative … top up", or 402 | `TranscriptionServiceError(failure_reason="quota_exceeded")` | `ai_service_quota_exceeded` (503) | Contact-the-administrator message, no retry button |
| AssemblyAI 401/403 | `InvalidConfigurationError` | `config_invalid` (503) | Contact-the-administrator message, no retry button |
| OpenRouter 402 | `ExtractionProviderAccountError("quota_exceeded")`, not retried | `ai_service_quota_exceeded` (503) | Contact-the-administrator message |
| OpenRouter 401 | `ExtractionProviderAccountError("credentials_invalid")`, not retried | `config_invalid` (503) | Contact-the-administrator message |
| OpenRouter 403 (moderation/guardrail/permission) | Ordinary extraction failure, retried | `extraction_failed` (502) | Generic extraction failure |
| Missing AssemblyAI/OpenRouter key | `ConfigurationError` | `config_missing` (503) | Contact-the-administrator message |

Account/config failures during automatic extraction (voice capture, text capture, re-extract) mark the capture `extraction_failed` with a sanitized `error_code` (`extraction_quota_exceeded` or `config_invalid`), preserving the transcript so it can be re-extracted after the account is fixed.

## Configuration

- New: `ASSEMBLYAI_API_URL` (default `https://api.assemblyai.com`), `ASSEMBLYAI_API_KEY`, `ASSEMBLYAI_SPEECH_MODELS` (CSV, default `universal-3-5-pro,universal-2`), `ASSEMBLYAI_POLL_INTERVAL_SECONDS` (default `1.0`).
- `TRANSCRIPTION_TIMEOUT_SECONDS` default raised from 20 to 30 to cover upload + queue + polling.
- Removed: `MISTRAL_API_URL`, `MISTRAL_API_KEY`, `MISTRAL_TRANSCRIPTION_MODEL` (ignored if still set).

## Verification

- Backend: full pytest suite passes, including new AssemblyAI client tests (`httpx.MockTransport`), OpenRouter 402/401/403 classification and no-retry tests, and capture-route quota tests for voice, text, submit, and re-extract.
- Frontend: capture model, capture view, and security-config tests pass; typecheck and lint clean.
- Not verified against live providers in this task (no AssemblyAI key configured locally).

## Known Limits

- If AssemblyAI accepts an upload but transcript submission fails, the orphaned upload cannot be deleted through the API (there is no transcript to delete); AssemblyAI auto-deletes `/v2/upload` files after 2 days.
- A transcript that times out while still processing may fail cleanup; this is logged as `transcription_provider_cleanup_failed`.
- Quota detection for AssemblyAI relies on its documented error wording because it returns 400 rather than 402 for a negative balance.
