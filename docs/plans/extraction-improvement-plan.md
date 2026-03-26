# Extraction Improvement Plan - IMPLEMENTED

## Problem Statement

The task extraction system was failing to properly decompose transcripts containing multiple related tasks and their subtasks.

**Sample Transcript:**
```
So I need to create a resume for AI product manager and start applying to some jobs using it to do that. I need to fix up my resume, do some research on what skills they should have and maybe upskill my skills too. And also I should uh I gotta call my dentist to probably tomorrow. Um around 9 a.m. to fix my metal thing in my mouth. Yeah.
```

**Expected Extraction (3 tasks with subtasks):**
1. **Task**: "Create resume for AI product manager"
   - **Subtask**: "Fix up my resume"
   - **Subtask**: "Do some research on what skills they should have"
   - **Subtask**: "Upskill my skills"
2. **Task**: "Apply to AI product manager jobs"
3. **Task**: "Call dentist tomorrow at 9am to fix metal thing in mouth" (with reminder)

## Root Cause Analysis

### Initial Implementation Issues

1. **Single-pass extraction**: The model was expected to parse, identify tasks, determine hierarchy, and extract metadata all in one pass
2. **Generic instructions**: The prompt only said "include subtasks when mentioned" without explicit decomposition rules
3. **No enforcement**: The model could skip items without consequence

## Implemented Solution

### Two-Pass Extraction Architecture

Changed from single-pass to two-pass extraction with mandatory enumeration step.

### 1. Updated System Prompt ([`backend/app/prompts/extraction_prompts.py`](backend/app/prompts/extraction_prompts.py))

**Key Changes:**
- **PASS 1: ENUMERATE ALL TASKS** - Mandatory enumeration of every actionable item before writing JSON
- **PASS 2: ORGANIZE INTO HIERARCHY** - Then organize into tasks/subtasks
- **EXPLICIT TASK COUNT** - Model must state "TOTAL: X tasks identified"
- **DO NOT SUMMARIZE** - Explicit rule against combining related actions

**Signal words explicitly handled:**
- "and", "also", "too" → SEPARATE parallel tasks
- "I gotta", "I should", "I need to" → NEW TASK
- "to do Y" → X is SUBTASK of Y

**Example format enforced:**
```
PASS 1 ENUMERATION:
ENUMERATED TASKS:
1. Create resume for AI product manager
2. Apply to AI product manager jobs (using the resume)
3. Fix up my resume
4. Do some research on what skills AI product managers should have
5. Upskill my skills for AI product manager job
6. Call dentist tomorrow at 9am about metal thing in mouth
TOTAL: 6 tasks identified

PASS 2 OUTPUT:
{json...}
```

### 2. Updated Extraction Service ([`backend/app/services/extraction.py`](backend/app/services/extraction.py))

**Key Changes:**
- Replaced `JsonOutputParser` with custom `RunnableLambda` that extracts JSON from mixed text output
- The model now outputs text + JSON, and we extract just the JSON portion
- Supports the two-pass format where enumeration text precedes the JSON

### 3. New Comprehensive Tests ([`backend/tests/test_extraction_comprehensive.py`](backend/tests/test_extraction_comprehensive.py))

Added 24 tests validating:
- Two-pass structure in system prompt
- PASS 1 enumeration with 6 tasks for test case
- PASS 2 organization with 3 final tasks
- Subtask decomposition
- Dentist task with reminder
- Additional examples (parallel tasks, project with subtasks)

## Files Modified

| File | Changes |
|------|---------|
| `backend/app/prompts/extraction_prompts.py` | Complete rewrite with two-pass extraction, explicit enumeration, comprehensive examples |
| `backend/app/services/extraction.py` | Changed from JsonOutputParser to custom JSON extractor for mixed text |
| `backend/tests/test_extraction_comprehensive.py` | New test file with 24 tests for two-pass extraction |
| `docs/build-plan.md` | Added ADH-07 documenting the completed work |

## Verification

The new prompts contain:
- ✅ PASS 1 ENUMERATION section
- ✅ PASS 2 OUTPUT section
- ✅ TOTAL: 6 tasks identified (for test case)
- ✅ Call dentist task with 09:00 reminder
- ✅ Fix up my resume, research skills, upskill as subtasks
- ✅ DO NOT SUMMARIZE OR COMBINE rule
- ✅ Signal word handling ("and" → separate tasks)

## Next Steps (if issues persist)

If the two-pass approach still doesn't work in production:

1. **Force separate calls**: Make the model output only the enumeration in first call, then JSON in second call
2. **Higher temperature**: Increase temperature for more thorough extraction
3. **Validation feedback**: If JSON parsing fails, pass error back to model for correction
4. **Model selection**: Try a different/better model for extraction
