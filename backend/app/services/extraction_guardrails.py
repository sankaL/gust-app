"""Deterministic guardrails for cross-domain extraction completeness."""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.services.extraction_models import ExtractedTaskCandidate

ACTION_VERBS = (
    "call",
    "text",
    "email",
    "message",
    "schedule",
    "book",
    "contact",
    "see",
    "visit",
    "buy",
    "pay",
    "pick up",
    "pickup",
    "renew",
)
ACTION_VERB_PATTERN = "|".join(sorted((re.escape(verb) for verb in ACTION_VERBS), key=len, reverse=True))
INTENT_CUE_PATTERN = re.compile(
    r"\b(?:i need to|need to|i should|should|i gotta|gotta|i have to|have to|"
    r"i want to|want to|remind me to|i'm going to|im going to|going to)\b",
    re.IGNORECASE,
)
SENTENCE_START_ACTION_PATTERN = re.compile(rf"^(?:{ACTION_VERB_PATTERN})\b", re.IGNORECASE)
ACTION_PATTERN = re.compile(rf"\b({ACTION_VERB_PATTERN})\b", re.IGNORECASE)
MEDICAL_KEYWORDS = {
    "dentist",
    "doctor",
    "orthodontist",
    "pharmacy",
    "prescription",
    "appointment",
    "clinic",
    "hospital",
    "therapist",
    "therapy",
    "vet",
}
COMMUNICATION_KEYWORDS = {
    "mom",
    "mother",
    "dad",
    "father",
    "parent",
    "parents",
    "sister",
    "brother",
    "friend",
    "landlord",
    "roommate",
    "wife",
    "husband",
    "partner",
}
ERRAND_KEYWORDS = {
    "groceries",
    "grocery",
    "laundry",
    "rent",
    "bill",
    "bills",
    "bank",
    "insurance",
    "mechanic",
    "registration",
    "oil",
}
DOMAIN_KEYWORDS = MEDICAL_KEYWORDS | COMMUNICATION_KEYWORDS | ERRAND_KEYWORDS
CONTINUATION_PATTERN = re.compile(
    r"^(?:um|uh|around|at|tomorrow|today|tonight|this|for|to|about)\b",
    re.IGNORECASE,
)
LEADING_NOISE_PATTERN = re.compile(r"^(?:and|also|and also|oh and|so|um|uh|yeah)\b[\s,]*", re.IGNORECASE)
STOPWORDS = {
    "a",
    "about",
    "also",
    "am",
    "an",
    "and",
    "around",
    "at",
    "for",
    "i",
    "in",
    "is",
    "it",
    "its",
    "me",
    "my",
    "of",
    "on",
    "pm",
    "probably",
    "should",
    "some",
    "that",
    "the",
    "to",
    "tomorrow",
    "too",
    "uh",
    "um",
    "using",
    "want",
    "with",
    "yeah",
}


@dataclass(frozen=True)
class GuardedIntent:
    raw_text: str
    normalized_text: str
    action_keywords: frozenset[str]
    domain_keywords: frozenset[str]
    significant_tokens: frozenset[str]


def detect_guarded_intents(transcript_text: str) -> list[GuardedIntent]:
    """Detect standalone guarded intents that must survive extraction."""
    sentences = _split_sentences(transcript_text)
    intents: list[GuardedIntent] = []

    index = 0
    while index < len(sentences):
        sentence = sentences[index]
        combined = sentence
        while _is_guarded_candidate(combined) and index + 1 < len(sentences):
            next_sentence = sentences[index + 1]
            if not CONTINUATION_PATTERN.match(next_sentence):
                break
            combined = f"{combined} {next_sentence}"
            index += 1

        intent = _build_intent(combined)
        if intent is not None and intent not in intents:
            intents.append(intent)
        index += 1

    return intents


def find_missing_guarded_intents(
    *,
    guarded_intents: list[GuardedIntent],
    extracted_tasks: list[ExtractedTaskCandidate],
) -> list[GuardedIntent]:
    """Return guarded intents not represented by top-level or subtask extracted tasks."""
    all_titles: list[str] = []
    for task in extracted_tasks:
        all_titles.append(task.title)
        # Also check subtask titles
        for subtask in task.subtasks:
            all_titles.append(subtask.title)
    return [
        intent
        for intent in guarded_intents
        if not any(_task_matches_intent(intent=intent, task_title=title) for title in all_titles)
    ]


def build_fallback_title(intent: GuardedIntent) -> str:
    """Create a user-visible fallback title from the detected clause."""
    if not intent.action_keywords:
        return "Review missed task"
    title = re.sub(r"([.!?])\s+", " ", intent.raw_text).strip(" .,!?:;")
    action_match = ACTION_PATTERN.search(title)
    if action_match is not None:
        title = title[action_match.start() :]
    if title:
        return title[0].upper() + title[1:]
    return "Review missed task"


def _split_sentences(transcript_text: str) -> list[str]:
    normalized = re.sub(r"\s+", " ", transcript_text).strip()
    if not normalized:
        return []
    return [
        _normalize_fragment(fragment)
        for fragment in re.split(r"(?<=[.!?])\s+", normalized)
        if _normalize_fragment(fragment)
    ]


def _normalize_fragment(value: str) -> str:
    cleaned = LEADING_NOISE_PATTERN.sub("", value.strip())
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip(" ")


def _is_guarded_candidate(fragment: str) -> bool:
    lowered = fragment.lower()
    if not any(keyword in lowered for keyword in DOMAIN_KEYWORDS):
        return False

    normalized = _normalize_fragment(fragment)
    return bool(INTENT_CUE_PATTERN.search(lowered) or SENTENCE_START_ACTION_PATTERN.match(normalized))


def _build_intent(fragment: str) -> GuardedIntent | None:
    if not _is_guarded_candidate(fragment):
        return None

    normalized_text = _canonicalize(fragment)
    action_keywords = frozenset(match.group(1).replace(" ", "") for match in ACTION_PATTERN.finditer(normalized_text))
    domain_keywords = frozenset(token for token in _tokenize(normalized_text) if token in DOMAIN_KEYWORDS)
    significant_tokens = frozenset(token for token in _tokenize(normalized_text) if token not in STOPWORDS)

    if not action_keywords or not domain_keywords:
        return None

    return GuardedIntent(
        raw_text=_normalize_fragment(fragment),
        normalized_text=normalized_text,
        action_keywords=action_keywords,
        domain_keywords=domain_keywords,
        significant_tokens=significant_tokens,
    )


def _task_matches_intent(*, intent: GuardedIntent, task_title: str) -> bool:
    normalized_task = _canonicalize(task_title)
    task_actions = {match.group(1).replace(" ", "") for match in ACTION_PATTERN.finditer(normalized_task)}
    task_tokens = set(_tokenize(normalized_task))
    significant_overlap = intent.significant_tokens & task_tokens

    # Exact or substring match
    if intent.normalized_text in normalized_task or normalized_task in intent.normalized_text:
        return True
    # Strong match: domain keyword + action keyword + significant token overlap
    if intent.domain_keywords & task_tokens and intent.action_keywords & task_actions:
        if len(significant_overlap) >= 1:
            return True
    # Weaker fallback: domain keyword match only (for near-miss cases where action differs)
    if intent.domain_keywords & task_tokens and task_actions:
        return True
    return False


def _canonicalize(value: str) -> str:
    lowered = value.lower()
    lowered = re.sub(r"[^a-z0-9\s]", " ", lowered)
    return re.sub(r"\s+", " ", lowered).strip()


def _tokenize(value: str) -> list[str]:
    return _canonicalize(value).split()
