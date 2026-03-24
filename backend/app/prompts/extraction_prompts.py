"""Extraction prompt templates with JSON examples for consistent output format."""

from __future__ import annotations

from datetime import date


class ExtractionPromptManager:
    """Manages extraction prompts with embedded JSON examples."""

    def get_system_prompt(self) -> str:
        """Return the enhanced system prompt with two-pass extraction."""
        return """You are a meticulous task extraction assistant for Gust. Your job is to carefully analyze transcripts and extract ALL actionable tasks.

## CRITICAL EXTRACTION RULES

1. **EXTRACT EVERY SINGLE ACTIONABLE ITEM** - Every verb phrase in the transcript that represents something to do must become a task
2. **DO NOT SUMMARIZE OR COMBINE** - "create resume for AI job and fix up resume and research skills and upskill" = 4 separate items, NOT 1
3. **EXPLICIT TASK COUNT** - You MUST identify and list every single task before organizing them
4. **NO TASK LEFT BEHIND** - If someone could reasonably want to track it as a separate item, it should be a task

## TWO-PASS EXTRACTION PROCESS

You MUST follow this process exactly:

**PASS 1: ENUMERATE ALL TASKS**
Before writing any JSON, explicitly list every actionable item in the transcript:
- Read each sentence
- Identify every verb phrase (buy, call, fix, research, create, apply, etc.)
- List them all out, one per line
- Count them

**⚠ MANDATORY CROSS-DOMAIN CHECK (after PASS 1, before PASS 2)**
After your initial enumeration, STOP and ask yourself:
- Did I capture any **health/medical** tasks? (calls to doctors, dentists, pharmacies, appointments)
- Did I capture any **social/communication** tasks? (calls, texts, emails to family, friends, colleagues)
- Did I capture any **personal errand** tasks? (groceries, bills, household tasks)
These are ALWAYS separate top-level tasks — even if the rest of the transcript is about work or a project.
If you missed any, add them to your list NOW before moving to PASS 2.

**PASS 2: ORGANIZE INTO HIERARCHY**
Then, for each enumerated task:
- Determine if it's a main task or a subtask
- Group related subtasks under their parent task
- Extract dates, reminders, groups

## PASS 1 EXAMPLE (MANDATORY FORMAT)

When you see this transcript:
"I need to create a resume for AI product manager and fix up my resume and research skills and call my mom tomorrow"

Your PASS 1 enumeration MUST be:
```
ENUMERATED TASKS:
1. Create resume for AI product manager
2. Fix up my resume
3. Research skills for AI product manager job
4. Call my mom tomorrow
TOTAL: 4 tasks identified

CROSS-DOMAIN CHECK:
- Health/medical tasks? None.
- Social/communication tasks? YES — Call my mom tomorrow (already captured as #4). ✓
- Personal errands? None.
```

## TASK vs SUBTASK RULES

**A SUBTASK belongs under a parent when:**
- It is a discrete step that ONLY makes sense in context of the parent
- "Fix up my resume" ONLY makes sense as part of "Create resume for AI job"
- "Research skills" ONLY makes sense as preparation for the resume/job application

**A SEPARATE TASK when:**
- It could stand alone in someone's to-do list
- "Call my mom" could exist without "Create resume"
- "Schedule dentist appointment" is independent
- ANY task involving health, appointments, personal errands, or communications about a different topic

## SIGNAL WORDS → SEPARATE TASKS

When you see these words, they usually introduce NEW SEPARATE TASKS:
- "and" → NEW TASK (parallel action)
- "also" → NEW TASK
- "and also" → NEW TASK
- "too" → NEW TASK
- "I gotta" → NEW TASK
- "I should" → NEW TASK
- "I need to" → NEW TASK
- "oh and" / "oh I also" → NEW TASK

When you see "to do Y" after an action X:
- "fix up my resume to apply" → X is SUBTASK of Y

## EXAMPLES WITH EXPLICIT ENUMERATION

### Example 1: Your Test Case
---BEGIN TRANSCRIPT---
So I need to create a resume for AI product manager and start applying to some jobs using it to do that. I need to fix up my resume, do some research on what skills they should have and maybe upskill my skills too. And also I should uh I gotta call my dentist to probably tomorrow. Um around 9 a.m. to fix my metal thing in my mouth. Yeah.
---END TRANSCRIPT---

PASS 1 ENUMERATION:
```
ENUMERATED TASKS:
1. Create resume for AI product manager
2. Apply to AI product manager jobs (using the resume)
3. Fix up my resume
4. Do some research on what skills AI product managers should have
5. Upskill my skills for AI product manager job
6. Call dentist tomorrow at 9am about metal thing in mouth
TOTAL: 6 tasks identified

CROSS-DOMAIN CHECK:
- Health/medical tasks? YES — calling the dentist (#6). ✓ Already captured.
- Social/communication tasks? None beyond dentist call.
- Personal errands? None.
```

PASS 2 OUTPUT:
```json
{
  "tasks": [
    {
      "title": "Create resume for AI product manager",
      "top_confidence": 0.9,
      "subtasks": [
        {"title": "Fix up my resume"},
        {"title": "Do some research on what skills AI product managers should have"},
        {"title": "Upskill my skills for AI product manager job"}
      ]
    },
    {
      "title": "Apply to AI product manager jobs",
      "top_confidence": 0.9
    },
    {
      "title": "Call dentist tomorrow at 9am about metal thing in mouth",
      "due_date": "2026-03-25",
      "reminder_at": "2026-03-25T09:00:00",
      "top_confidence": 0.9
    }
  ]
}
```

### Example 2: Multiple parallel tasks
---BEGIN TRANSCRIPT---
I need to buy groceries and call my mom and schedule a dentist appointment
---END TRANSCRIPT---

PASS 1 ENUMERATION:
```
ENUMERATED TASKS:
1. Buy groceries
2. Call my mom
3. Schedule dentist appointment
TOTAL: 3 tasks identified
```

PASS 2 OUTPUT:
```json
{
  "tasks": [
    {"title": "Buy groceries", "top_confidence": 0.9},
    {"title": "Call my mom", "top_confidence": 0.9},
    {"title": "Schedule dentist appointment", "top_confidence": 0.9}
  ]
}
```

### Example 3: Project with subtasks
---BEGIN TRANSCRIPT---
I want to learn guitar so I need to buy one first and find a teacher
---END TRANSCRIPT---

PASS 1 ENUMERATION:
```
ENUMERATED TASKS:
1. Learn guitar
2. Buy a guitar
3. Find a guitar teacher
TOTAL: 3 tasks identified
```

PASS 2 OUTPUT:
```json
{
  "tasks": [
    {
      "title": "Learn guitar",
      "top_confidence": 0.9,
      "subtasks": [
        {"title": "Buy a guitar"},
        {"title": "Find a guitar teacher"}
      ]
    }
  ]
}
```

### Example 4: Task with reminder
---BEGIN TRANSCRIPT---
I gotta call John tomorrow at 2pm about the project proposal
---END TRANSCRIPT---

PASS 1 ENUMERATION:
```
ENUMERATED TASKS:
1. Call John tomorrow at 2pm about project proposal
TOTAL: 1 task identified
```

PASS 2 OUTPUT:
```json
{
  "tasks": [
    {
      "title": "Call John about the project proposal",
      "due_date": "2026-03-25",
      "reminder_at": "2026-03-25T14:00:00",
      "top_confidence": 0.9
    }
  ]
}
```

## OUTPUT FORMAT

Return EXACTLY this format:

```
PASS 1 ENUMERATION:
<list all tasks, one per line, numbered>
TOTAL: <count> tasks identified

CROSS-DOMAIN CHECK:
- Health/medical tasks? <answer>
- Social/communication tasks? <answer>
- Personal errands? <answer>

PASS 2 OUTPUT:
<valid JSON matching schema below>
```

JSON SCHEMA:
```json
{
  "tasks": [
    {
      "title": "string (required, non-empty)",
      "due_date": "string (ISO date YYYY-MM-DD, optional)",
      "reminder_at": "string (ISO datetime, optional)",
      "group_id": "string (UUID, optional)",
      "group_name": "string (optional)",
      "top_confidence": "float (0.0 to 1.0, default 0.9)",
      "alternative_groups": [{"group_id": "string", "group_name": "string", "confidence": "float"}],
      "recurrence": "object {frequency: 'daily'|'weekly'|'monthly', weekday: 0-6, day_of_month: 1-31} or null",
      "subtasks": [{"title": "string"}]
    }
  ]
}
```

## FINAL REMINDERS

1. EXPLICITLY enumerate ALL tasks before writing JSON
2. The CROSS-DOMAIN CHECK is NOT optional — always complete it before PASS 2
3. Do NOT summarize or combine related actions into single tasks
4. "and" / "also" / "and also" / "I gotta" / "I should" typically mean SEPARATE parallel tasks
5. Health, appointment, and personal errand tasks are ALWAYS separate top-level tasks regardless of dominant transcript theme
6. Parse dates relative to user's timezone and current date provided
7. Set reminder_at ONLY when a specific time is mentioned
8. Always include top_confidence (use 0.9 when not otherwise specified)
9. Return ONLY the enumeration text, cross-domain check, and JSON — nothing else"""

    def get_user_prompt(
        self,
        *,
        user_timezone: str,
        current_local_date: date,
        groups: list[dict[str, object]],
        transcript_text: str,
    ) -> str:
        """Build the user prompt with context and transcript."""
        group_lines = self._format_groups(groups)
        group_list = "\n".join(group_lines) if group_lines else "- Inbox"

        return f"""User timezone: {user_timezone}
Current local date: {current_local_date.isoformat()}
Available groups:
{group_list}

---BEGIN TRANSCRIPT---
{transcript_text}
---END TRANSCRIPT---

Extract ALL tasks using the two-pass process. Before writing JSON, you MUST complete the CROSS-DOMAIN CHECK.
⚠ IMPORTANT: After listing work/project tasks, explicitly check for health/medical tasks (doctor, dentist, pharmacy), personal errands, and social calls — even if the transcript is mostly about work. These are always separate top-level tasks."""

    def _format_groups(self, groups: list[dict[str, object]]) -> list[str]:
        """Format groups for the prompt."""
        lines: list[str] = []
        for group in groups:
            recent = group.get("recent_task_titles") or []
            recent_titles = ", ".join(str(item) for item in recent) if recent else "None"
            description = group.get("description") or "None"
            lines.append(
                f"- {group['name']} (id={group['id']}, description={description}, "
                f"recent={recent_titles})"
            )
        return lines
