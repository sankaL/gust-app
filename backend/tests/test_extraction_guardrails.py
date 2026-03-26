from __future__ import annotations

from app.services.extraction_guardrails import (
    build_fallback_title,
    detect_guarded_intents,
    find_missing_guarded_intents,
    GuardedIntent,
)
from app.services.extraction_models import ExtractedTaskCandidate, ExtractionSubtask


TRANSCRIPT = (
    "So I need to create a resume for AI product manager and start applying to some jobs "
    "using it to do that. I need to fix up my resume, do some research on what skills they "
    "should have and maybe upskill my skills too. And also I should uh I gotta call my "
    "dentist to probably tomorrow. Um around 9 a.m. to fix my metal thing in my mouth. Yeah."
)


def test_detect_guarded_intents_finds_dentist_clause() -> None:
    intents = detect_guarded_intents(TRANSCRIPT)

    assert len(intents) == 1
    assert "call my dentist" in intents[0].raw_text.lower()
    assert "around 9 a.m." in intents[0].raw_text.lower()


def test_detect_guarded_intents_ignores_non_actionable_mentions() -> None:
    transcript = "The dentist called me yesterday and the appointment is already done."

    intents = detect_guarded_intents(transcript)

    assert intents == []


def test_find_missing_guarded_intents_still_missing_with_only_unrelated_subtasks() -> None:
    intents = detect_guarded_intents(TRANSCRIPT)
    tasks = [
        ExtractedTaskCandidate(
            title="Create resume for AI product manager",
            top_confidence=0.9,
            subtasks=[ExtractionSubtask(title="Fix up my resume")],
        )
    ]

    missing = find_missing_guarded_intents(guarded_intents=intents, extracted_tasks=tasks)

    assert len(missing) == 1


def test_find_missing_guarded_intents_accepts_matching_top_level_task() -> None:
    intents = detect_guarded_intents(TRANSCRIPT)
    tasks = [
        ExtractedTaskCandidate(
            title="Call dentist tomorrow at 9am about metal thing in mouth",
            top_confidence=0.9,
        )
    ]

    missing = find_missing_guarded_intents(guarded_intents=intents, extracted_tasks=tasks)

    assert missing == []


def test_find_missing_guarded_intents_accepts_matching_subtask() -> None:
    """When a guarded intent (dentist call) is a subtask, it should be found."""
    intents = detect_guarded_intents(TRANSCRIPT)
    tasks = [
        ExtractedTaskCandidate(
            title="Create resume for AI product manager",
            top_confidence=0.9,
            subtasks=[
                ExtractionSubtask(title="Fix up my resume"),
                ExtractionSubtask(title="Call dentist tomorrow at 9am about metal thing in mouth"),
                ExtractionSubtask(title="Upskill my skills"),
            ],
        )
    ]

    missing = find_missing_guarded_intents(guarded_intents=intents, extracted_tasks=tasks)

    # Should NOT be missing because it's in subtasks (after our fix)
    assert missing == []


def test_build_fallback_title_handles_multi_word_action() -> None:
    """Multi-word actions like 'pick up' should be handled correctly."""
    intent = GuardedIntent(
        raw_text="I gotta pick up my prescription at the pharmacy",
        normalized_text="gotta pickup my prescription at the pharmacy",
        action_keywords=frozenset({"pickup"}),
        domain_keywords=frozenset({"pharmacy", "prescription"}),
        significant_tokens=frozenset({"pickup", "prescription", "pharmacy", "gotta"}),
    )
    title = build_fallback_title(intent)
    assert "pickup" in title.lower() or "pick up" in title.lower()
    assert title[0].isupper(), f"Title should start with uppercase: {title}"


def test_build_fallback_title_handles_no_action() -> None:
    """If action_keywords is empty, should fall back to 'Review missed task'."""
    intent = GuardedIntent(
        raw_text="I need to see the dentist",
        normalized_text="need to see the dentist",
        action_keywords=frozenset(),  # Empty!
        domain_keywords=frozenset({"dentist"}),
        significant_tokens=frozenset({"need", "see", "dentist"}),
    )
    title = build_fallback_title(intent)
    assert title == "Review missed task"


def test_build_fallback_title_strips_trailing_punctuation() -> None:
    """Periods and other punctuation should be stripped from the title."""
    intent = GuardedIntent(
        raw_text="I gotta call my dentist tomorrow.",
        normalized_text="gotta call my dentist tomorrow",
        action_keywords=frozenset({"call"}),
        domain_keywords=frozenset({"dentist"}),
        significant_tokens=frozenset({"gotta", "call", "dentist", "tomorrow"}),
    )
    title = build_fallback_title(intent)
    assert not title.endswith("."), f"Title should not end with period: {title}"
    assert "dentist" in title.lower()


def test_build_fallback_title_preserves_contextual_words() -> None:
    """Contextual words like 'tomorrow', 'around' should be preserved in title."""
    intent = GuardedIntent(
        raw_text="I gotta call my dentist to probably tomorrow around 9 a.m.",
        normalized_text="gotta call my dentist to probably tomorrow around 9 a m",
        action_keywords=frozenset({"call"}),
        domain_keywords=frozenset({"dentist"}),
        significant_tokens=frozenset({"gotta", "call", "dentist", "tomorrow", "9", "a", "m"}),
    )
    title = build_fallback_title(intent)
    assert "dentist" in title.lower()
    # Time context should be preserved
    assert "9" in title or "tomorrow" in title.lower()
