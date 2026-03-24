# Solution Options: Intermittent Dentist Task Extraction Failure

## Context

The "call dentist" task is intermittently missed during extraction (~90% failure rate based on user's testing). The two-pass extraction prompt and guardrails system are in place, but the dentist task still gets dropped.

## Observed Behavior

From the trace provided:
- LLM correctly enumerates 6 tasks including "Call my dentist tomorrow at 9 a.m." in PASS 1
- LLM correctly includes dentist task in PASS 2 JSON output
- Yet user reports ~90% failure rate in practice

This inconsistency suggests the issue is **not with the prompt itself** but with:
1. Model-level inconsistency (different models behave differently)
2. Edge cases in JSON parsing
3. Guardrail timing/matching issues

---

## Solution Options

### Option 1: Enhanced JSON Extraction Robustness

**Approach**: Make `extract_json_from_text` more robust to different output formats.

**Changes**:
- Improve regex for PASS 2 OUTPUT detection to handle variations ("PASS TWO", "pass 2 output:", etc.)
- Add fallback strategies when primary parsing fails
- Log parsing failures for debugging

**Pros**:
- Non-invasive change
- Improves reliability across all transcripts

**Cons**:
- May not address the root cause if LLM is outputting correct JSON

**Confidence**: 60%

---

### Option 2: Force JSON-Only Output

**Approach**: Change prompt to request ONLY JSON output, removing the two-pass text format.

**Changes**:
- Update `get_system_prompt()` to request direct JSON
- Keep PASS 1 enumeration as internal reasoning but only output JSON
- Use JSON mode if supported by the model

**Pros**:
- Eliminates JSON extraction complexity
- Cleaner output format
- May improve with models that support JSON mode

**Cons**:
- Loses the benefit of explicit enumeration before organization
- May not teach the model to be as thorough

**Confidence**: 50%

---

### Option 3: Strengthen Guardrails Detection

**Approach**: Improve the guardrails system to catch more cases where health/medical tasks are missed.

**Changes**:
- Lower the matching threshold in `_task_matches_intent`
- Add more medical keywords to `MEDICAL_KEYWORDS` set
- Make guardrail check more aggressive (always add fallback for medical tasks)

**Pros**:
- Catches more missed medical tasks
- Works as a safety net regardless of LLM behavior

**Cons**:
- May create false positives (adding dentist task when already extracted)
- Requires careful tuning of matching logic

**Confidence**: 70%

---

### Option 4: Structured Output / JSON Mode

**Approach**: Use the model's native JSON mode or structured output feature if available.

**Changes**:
- Configure LLM to use JSON mode (OpenAI, Anthropic, etc. support this)
- Remove text preamble entirely
- Parse JSON directly without extraction

**Pros**:
- Most reliable approach if supported
- Eliminates parsing issues entirely

**Cons**:
- Requires model support
- May need provider-specific code

**Confidence**: 80% (if supported)

---

### Option 5: Add Mandatory Health Task Section

**Approach**: Explicitly instruct the model to output a separate "health_tasks" array in addition to regular tasks.

**Changes**:
- Add section to prompt: "Health/Medical Tasks: List all health-related tasks separately"
- Modify JSON schema to include optional `health_tasks` array
- Modify parsing to extract both arrays

**Pros**:
- Forces model to consider health tasks as distinct
- Clear separation reduces chance of omission

**Cons**:
- Changes the output schema
- May be overkill if guardrails already work

**Confidence**: 75%

---

## Recommended Approach

Given the intermittent nature and the fact that the trace shows correct behavior, I recommend:

**Immediate**: Implement **Option 1 (Enhanced JSON Extraction)** + **Option 3 (Strengthen Guardrails)** together.

This addresses:
1. JSON parsing edge cases that might silently drop tasks
2. Guardrails that might not catch all missed medical tasks

**Longer term**: Investigate **Option 4 (JSON Mode)** if the above doesn't fully resolve it.

---

## Implementation Notes

### Option 1 + 3 Combined Changes

In `backend/app/services/extraction.py`:
- Enhanced `extract_json_from_text` to handle format variations
- Add logging to track parsing success/failure

In `backend/app/services/extraction_guardrails.py`:
- Lower matching threshold for `_task_matches_intent`
- Add explicit health/medical keyword detection

---

## Questions Before Implementation

1. Which model provider are you using primarily? (OpenAI, Anthropic, Google, etc.)
2. Do you have logs from recent failed extractions that show the raw LLM output?
3. Is the issue specific to this transcript, or do other health tasks (doctor, therapy) also fail?
4. Would you prefer a quick fix (guardrails) or thorough fix (JSON mode)?

---

## Files to Modify

| File | Changes |
|------|---------|
| `backend/app/services/extraction.py` | Enhanced JSON extraction |
| `backend/app/services/extraction_guardrails.py` | Strengthened matching |
| `backend/tests/test_extraction_guardrails.py` | Add tests for edge cases |