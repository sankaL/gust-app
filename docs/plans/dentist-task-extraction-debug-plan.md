# Debug Plan: Intermittent Dentist Task Extraction Failure

## Objective

Diagnose why the "call dentist" task is intermittently missed during extraction despite the two-pass prompt and guardrails system.

## Hypothesis

The failure is likely occurring at one of these points:
1. LLM doesn't include dentist task in PASS 2 JSON output (despite enumerating it in PASS 1)
2. Guardrails don't detect the dentist clause as a guarded intent
3. Guardrails detect the intent but matching fails
4. JSON parsing extracts wrong content due to format variation
5. Task is extracted but filtered/lost downstream

## Diagnostic Steps

### Step 1: Add Comprehensive Logging to Extraction Pipeline

Add detailed logging in `_execute_extraction` to capture:
```python
# Log raw LLM output before parsing
logger.debug(
    "extraction_raw_llm_output",
    extra={
        "event": "extraction_raw_llm_output",
        "model": model_config.model_id,
        "output_length": len(raw_output),
        "has_pass2_marker": "PASS 2 OUTPUT" in raw_output,
        "output_preview": raw_output[:1000],  # First 1000 chars
    },
)
```

### Step 2: Log Guardrail Detection

Add logging in `_extract_payload_with_guardrails`:
```python
logger.info(
    "guardrails_check_results",
    extra={
        "event": "guardrails_check_results",
        "guarded_intents_count": len(guarded_intents),
        "guarded_intents": [i.raw_text for i in guarded_intents],
        "missing_intents_count": len(missing_guarded_intents),
        "missing_intents": [i.raw_text for i in missing_guarded_intents],
        "repair_triggered": len(missing_guarded_intents) > 0,
    },
)
```

### Step 3: Track Model Used per Extraction

Log the exact model ID for each extraction attempt to identify if failures correlate with specific models.

### Step 4: Instrument JSON Parsing

Log what `extract_json_from_text` actually extracts:
```python
# In extract_json_from_text function
logger.debug(
    "json_extraction_result",
    extra={
        "event": "json_extraction_result",
        "pass2_match_found": pass2_match is not None,
        "json_match_found": json_match is not None,
        "extracted_json_preview": str(result)[:500] if result else None,
    },
)
```

### Step 5: Create Test Harness

Create a local test that:
1. Uses the exact transcript you provided
2. Calls the extraction service with debug logging enabled
3. Captures the full raw output and parsed result
4. Runs multiple times to see inconsistency

## Implementation

### File: `backend/app/services/extraction.py`

Add logging to `_execute_extraction` method around line 267-275:

```python
# After LLM invocation, before parsing
raw_result = llm_response  # Need to capture this
logger.debug(
    "extraction_raw_response",
    extra={
        "event": "extraction_raw_response",
        "model": model_config.model_id,
        "response_content_type": type(raw_result).__name__,
        "response_preview": str(raw_result)[:2000],
    },
)
```

### File: `backend/app/services/capture.py`

Add logging to `_extract_payload_with_guardrails` around line 666-701:

```python
# After detecting guarded intents
logger.info(
    "guardrails_initial_check",
    extra={
        "event": "guardrails_initial_check",
        "guarded_intents": [{"raw": i.raw_text, "domain": list(i.domain_keywords)} for i in guarded_intents],
        "extracted_task_count": len(payload.tasks),
        "extracted_task_titles": [t.title for t in payload.tasks],
    },
)

# After finding missing intents
if missing_guarded_intents:
    logger.warning(
        "guardrails_detected_missing",
        extra={
            "event": "guardrails_detected_missing",
            "missing_count": len(missing_guarded_intents),
            "missing_intents": [i.raw_text for i in missing_guided_intents],
        },
    )
```

## Testing Strategy

### Unit Test: Guardrail Detection

Ensure guardrails correctly identify the dentist clause:
```python
def test_detect_guarded_intents_dentist() -> None:
    transcript = "And also I should uh I gotta call my dentist to probably tomorrow."
    intents = detect_guarded_intents(transcript)
    assert len(intents) == 1
    assert "dentist" in intents[0].domain_keywords
    assert "call" in intents[0].action_keywords
```

### Integration Test: Full Extraction Flow

Test with the exact transcript multiple times to detect inconsistency:
```python
@pytest.mark.parametrize("run", range(10))
async def test_extraction_consistency(run: int) -> None:
    # Same transcript, check if dentist task extracted consistently
```

## Success Criteria

After implementing diagnostics, we should be able to answer:
1. Is the LLM consistently outputting the dentist task in PASS 1 but sometimes dropping it in PASS 2?
2. Is the guardrail detection working correctly?
3. Is the JSON parsing failing for certain output formats?
4. Is there a downstream filtering issue?

## Notes

- These diagnostics should be temporary and removed or reduced in verbosity after the issue is found
- Consider using structured logging (already in use) with `extra` fields for easy querying
- The staging table already has `needs_review` and `top_confidence` fields - check if dentist tasks have unusual values when they appear