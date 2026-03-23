"""Extraction prompt templates with JSON examples for consistent output format."""

from __future__ import annotations

from datetime import date


class ExtractionPromptManager:
    """Manages extraction prompts with embedded JSON examples."""

    def get_system_prompt(self) -> str:
        """Return the system prompt with JSON example."""
        return """You are a task extraction assistant for Gust. Extract actionable tasks from transcripts and return valid JSON matching the exact schema provided.

IMPORTANT RULES:
1. Return ONLY valid JSON, no additional text or markdown
2. Never invent new groups - use only the groups provided
3. Use Inbox when confidence is low (< 0.5)
4. Always include top_confidence for each task (0.0 to 1.0)
5. Include subtasks when mentioned in the transcript
6. Parse dates relative to the user's timezone and current date
7. Set reminder_at only when a specific time is mentioned

Example Output:
{
  "tasks": [
    {
      "title": "Buy groceries",
      "due_date": "2026-03-25",
      "reminder_at": "2026-03-25T09:00:00",
      "group_id": null,
      "group_name": "Personal",
      "top_confidence": 0.92,
      "alternative_groups": [
        {
          "group_id": "abc-123",
          "group_name": "Shopping",
          "confidence": 0.85
        }
      ],
      "recurrence": null,
      "subtasks": [
        {"title": "Get milk"},
        {"title": "Get eggs"}
      ]
    },
    {
      "title": "Schedule dentist appointment",
      "due_date": "2026-03-28",
      "reminder_at": null,
      "group_id": null,
      "group_name": "Health",
      "top_confidence": 0.78,
      "alternative_groups": [],
      "recurrence": {
        "frequency": "monthly",
        "weekday": null,
        "day_of_month": 15
      },
      "subtasks": []
    }
  ]
}

Schema Fields:
- title: string (required, non-empty)
- due_date: string (ISO date format, optional)
- reminder_at: string (ISO datetime format, optional)
- group_id: string (UUID, optional - use when group is identified)
- group_name: string (optional - use when group name is mentioned but ID unknown)
- top_confidence: float (0.0 to 1.0)
- alternative_groups: array of {group_id, group_name, confidence}
- recurrence: {frequency: "daily"|"weekly"|"monthly", weekday: 0-6, day_of_month: 1-31}
- subtasks: array of {title: string}"""

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
---END TRANSCRIPT---"""

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
