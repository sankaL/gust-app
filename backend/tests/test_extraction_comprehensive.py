"""Comprehensive extraction tests to validate two-pass extraction."""

from __future__ import annotations

import pytest
from datetime import date

from app.prompts.extraction_prompts import ExtractionPromptManager


class TestExtractionPromptManager:
    """Tests for the two-pass extraction prompt manager."""

    def setup_method(self) -> None:
        self.manager = ExtractionPromptManager()

    def test_system_prompt_contains_two_pass_structure(self) -> None:
        """System prompt should require two-pass extraction."""
        prompt = self.manager.get_system_prompt()
        assert "PASS 1:" in prompt
        assert "PASS 2:" in prompt
        assert "ENUMERATE ALL TASKS" in prompt

    def test_system_prompt_emphasizes_enumeration(self) -> None:
        """System prompt should emphasize explicit task enumeration."""
        prompt = self.manager.get_system_prompt()
        assert "EXPLICIT TASK COUNT" in prompt
        assert "TOTAL:" in prompt
        assert "tasks identified" in prompt

    def test_system_prompt_prohibits_summarizing(self) -> None:
        """System prompt should explicitly forbid summarizing."""
        prompt = self.manager.get_system_prompt()
        assert "DO NOT SUMMARIZE OR COMBINE" in prompt
        assert "NOT 1" in prompt

    def test_system_prompt_contains_test_case_with_6_tasks(self) -> None:
        """The test case should show 6 tasks being enumerated."""
        prompt = self.manager.get_system_prompt()
        assert "TOTAL: 6 tasks identified" in prompt

    def test_test_case_includes_dentist_task(self) -> None:
        """Test case should include the dentist call task."""
        prompt = self.manager.get_system_prompt()
        assert "Call dentist" in prompt
        assert "09:00" in prompt or "9 a.m." in prompt

    def test_system_prompt_examples_include_top_confidence(self) -> None:
        """All example JSON objects must include top_confidence to teach the model."""
        prompt = self.manager.get_system_prompt()
        assert '"top_confidence": 0.9' in prompt

    def test_system_prompt_includes_domain_separation_rule(self) -> None:
        """Prompt should state that different-domain tasks are always separate."""
        prompt = self.manager.get_system_prompt()
        assert "health" in prompt.lower() or "appointment" in prompt.lower()

    def test_signal_words_include_and_also(self) -> None:
        """'and also' should be listed as a signal word for a new task."""
        prompt = self.manager.get_system_prompt()
        assert "and also" in prompt.lower()

    def test_test_case_includes_all_subtasks(self) -> None:
        """Test case should enumerate fix up resume, research skills, upskill."""
        prompt = self.manager.get_system_prompt()
        assert "Fix up my resume" in prompt
        assert "research" in prompt.lower()
        assert "Upskill" in prompt

    def test_system_prompt_has_no_template_syntax(self) -> None:
        """System prompt should not contain template syntax."""
        prompt = self.manager.get_system_prompt()
        assert "{{" not in prompt
        assert "}}" not in prompt

    def test_system_prompt_does_not_request_needs_review(self) -> None:
        """System prompt should not request fields outside schema."""
        prompt = self.manager.get_system_prompt()
        assert "needs_review" not in prompt

    def test_user_prompt_refers_to_two_pass_process(self) -> None:
        """User prompt should reference the two-pass process."""
        prompt = self.manager.get_user_prompt(
            user_timezone="UTC",
            current_local_date=date(2026, 3, 24),
            groups=[],
            transcript_text="Test transcript",
        )
        assert "two-pass" in prompt.lower() or "cross-domain" in prompt.lower()

    def test_user_prompt_includes_context(self) -> None:
        """User prompt should include timezone, date, groups, transcript."""
        prompt = self.manager.get_user_prompt(
            user_timezone="America/Toronto",
            current_local_date=date(2026, 3, 24),
            groups=[
                {
                    "id": "abc-123",
                    "name": "Work",
                    "description": "Job related",
                    "recent_task_titles": ["Update resume"],
                }
            ],
            transcript_text="Test transcript",
        )
        assert "America/Toronto" in prompt
        assert "2026-03-24" in prompt
        assert "Work" in prompt
        assert "---BEGIN TRANSCRIPT---" in prompt
        assert "Test transcript" in prompt

    def test_user_prompt_falls_back_to_inbox(self) -> None:
        """User prompt should use Inbox when no groups provided."""
        prompt = self.manager.get_user_prompt(
            user_timezone="UTC",
            current_local_date=date(2026, 3, 24),
            groups=[],
            transcript_text="Test transcript",
        )
        assert "- Inbox" in prompt


class TestExtractionExamples:
    """Tests to validate the two-pass extraction examples."""

    def setup_method(self) -> None:
        self.manager = ExtractionPromptManager()
        self.prompt = self.manager.get_system_prompt()

    def test_test_case_pass1_enumerates_6_tasks(self) -> None:
        """PASS 1 should show 6 tasks enumerated."""
        assert "ENUMERATED TASKS:" in self.prompt
        assert "1. Create resume for AI product manager" in self.prompt
        assert "2. Apply to AI product manager jobs" in self.prompt
        assert "3. Fix up my resume" in self.prompt
        assert "4. Do some research" in self.prompt
        assert "5. Upskill my skills" in self.prompt
        assert "6. Call dentist tomorrow" in self.prompt

    def test_test_case_shows_3_final_tasks(self) -> None:
        """PASS 2 should show 3 organized tasks with subtasks."""
        # Should have 3 main tasks and a PASS 2 OUTPUT marker
        assert "PASS 2 OUTPUT:" in self.prompt
        assert '"title": "Create resume for AI product manager"' in self.prompt
        assert '"title": "Apply to AI product manager jobs"' in self.prompt
        assert '"title": "Call dentist tomorrow at 9am about metal thing in mouth"' in self.prompt

    def test_test_case_first_task_has_3_subtasks(self) -> None:
        """First task should have 3 subtasks enumerated."""
        # The subtasks should be listed under the first task
        assert "Fix up my resume" in self.prompt
        assert "Do some research on what skills" in self.prompt
        assert "Upskill my skills" in self.prompt

    def test_dentist_task_has_reminder(self) -> None:
        """Dentist task should have reminder_at set to 9am."""
        assert "2026-03-25T09:00:00" in self.prompt

    def test_parallel_tasks_example(self) -> None:
        """Parallel tasks example should show 3 separate tasks."""
        assert "buy groceries and call my mom and schedule" in self.prompt
        # Should show 3 separate tasks
        assert '"title": "Buy groceries"' in self.prompt
        assert '"title": "Call my mom"' in self.prompt
        assert '"title": "Schedule dentist appointment"' in self.prompt

    def test_project_subtasks_example(self) -> None:
        """Project example should show guitar task with 2 subtasks."""
        assert '"title": "Learn guitar"' in self.prompt
        assert '"title": "Buy a guitar"' in self.prompt
        assert '"title": "Find a guitar teacher"' in self.prompt
