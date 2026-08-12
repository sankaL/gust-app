from datetime import UTC, date, datetime

import pytest

from app.services.task_rules import due_bucket_for_date


def test_due_bucket_normalizes_injected_now_to_user_timezone() -> None:
    now = datetime(2026, 8, 13, 2, tzinfo=UTC)

    assert due_bucket_for_date(
        due_date=date(2026, 8, 12),
        user_timezone="America/Toronto",
        now=now,
    ) == "due_soon"
    assert due_bucket_for_date(
        due_date=date(2026, 8, 12),
        user_timezone="UTC",
        now=now,
    ) == "overdue"


def test_due_bucket_rejects_naive_injected_now() -> None:
    with pytest.raises(ValueError, match="must include a timezone"):
        due_bucket_for_date(
            due_date=date(2026, 8, 12),
            user_timezone="America/Toronto",
            now=datetime(2026, 8, 12, 22),
        )
