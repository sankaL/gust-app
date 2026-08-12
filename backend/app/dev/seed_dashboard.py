from __future__ import annotations

import sys
import uuid
from datetime import UTC, date, datetime, time, timedelta

import sqlalchemy as sa

from app.core.settings import get_settings
from app.db.engine import internal_job_connection_scope, user_connection_scope
from app.db.schema import groups, tasks

LOCAL_DEV_AUTH_EMAIL = "local-dev@gust.local"
SEED_MARKER = "[dev-seed:desktop-dashboard]"


def main(*, only_if_empty: bool = False) -> None:
    settings = get_settings()
    if not settings.gust_dev_mode:
        raise RuntimeError("Refusing to seed dashboard data outside GUST_DEV_MODE=true.")

    with internal_job_connection_scope(settings.database_url) as connection:
        user_row = connection.execute(
            sa.text("select id from users where lower(email) = lower(:email)"),
            {"email": LOCAL_DEV_AUTH_EMAIL},
        ).first()

    if user_row is None:
        raise RuntimeError(
            "Local dev user does not exist yet. Sign in with the local test account once, "
            "then run the dashboard seed again."
        )

    user_id = str(user_row.id)
    if only_if_empty and _has_local_data(user_id=user_id, database_url=settings.database_url):
        print(f"Skipped dashboard seed for {LOCAL_DEV_AUTH_EMAIL}; local data already exists.")
        return

    today = date.today()
    with user_connection_scope(settings.database_url, user_id=user_id) as connection:
        group_ids = _ensure_seed_groups(connection, user_id=user_id)
        _clear_previous_seed(connection, user_id=user_id)
        inserted_count = _insert_seed_tasks(
            connection,
            user_id=user_id,
            group_ids=group_ids,
            today=today,
        )

    print(
        f"Seeded {inserted_count} dashboard tasks for {LOCAL_DEV_AUTH_EMAIL} "
        f"from {today.isoformat()} through {(today + timedelta(days=6)).isoformat()}."
    )


def _has_local_data(*, user_id: str, database_url: str) -> bool:
    with user_connection_scope(database_url, user_id=user_id) as connection:
        row = connection.execute(
            sa.select(tasks.c.id).where(tasks.c.user_id == user_id).limit(1)
        ).first()
    return row is not None


def _ensure_seed_groups(connection, *, user_id: str) -> dict[str, str]:
    desired_groups = {
        "Inbox": {
            "description": None,
            "is_system": True,
            "system_key": "inbox",
        },
        "Chores": {
            "description": "Home maintenance and recurring household work.",
            "is_system": False,
            "system_key": None,
        },
        "Jobs": {
            "description": "Career, admin, and project follow-ups.",
            "is_system": False,
            "system_key": None,
        },
    }
    group_ids: dict[str, str] = {}

    for name, values in desired_groups.items():
        if values["system_key"]:
            existing = connection.execute(
                sa.select(groups.c.id).where(
                    groups.c.user_id == user_id,
                    groups.c.system_key == values["system_key"],
                )
            ).first()
        else:
            existing = connection.execute(
                sa.select(groups.c.id).where(
                    groups.c.user_id == user_id,
                    sa.func.lower(groups.c.name) == name.lower(),
                )
            ).first()

        if existing is not None:
            group_ids[name] = str(existing.id)
            continue

        group_id = str(uuid.uuid4())
        connection.execute(
            groups.insert().values(
                id=group_id,
                user_id=user_id,
                name=name,
                description=values["description"],
                is_system=values["is_system"],
                system_key=values["system_key"],
            )
        )
        group_ids[name] = group_id

    return group_ids


def _clear_previous_seed(connection, *, user_id: str) -> None:
    connection.execute(
        tasks.delete().where(
            tasks.c.user_id == user_id,
            tasks.c.description.like(f"%{SEED_MARKER}%"),
        )
    )


def _insert_seed_tasks(
    connection,
    *,
    user_id: str,
    group_ids: dict[str, str],
    today: date,
) -> int:
    now = datetime.now(UTC)
    rows: list[dict[str, object]] = []

    open_tasks = [
        ("Clean the vents", "Chores", today - timedelta(days=26), False),
        ("Install the fanhood", "Inbox", today - timedelta(days=21), False),
        ("Send a meeting to the team", "Inbox", today - timedelta(days=17), True),
        ("Buy replacement air filters", "Chores", today, False),
        ("File contractor invoice", "Jobs", today + timedelta(days=1), False),
        ("Clean the vents every week", "Inbox", today + timedelta(days=5), False),
        ("Clean the vents", "Inbox", today + timedelta(days=5), False),
        ("Draft Friday status note", "Jobs", today + timedelta(days=6), True),
        ("Sort capture inbox", "Inbox", None, False),
        ("Plan grocery reset", "Chores", today + timedelta(days=3), False),
    ]
    for index, (title, group_name, due_date, needs_review) in enumerate(open_tasks):
        rows.append(
            _task_row(
                user_id=user_id,
                group_id=group_ids[group_name],
                title=title,
                status="open",
                due_date=due_date,
                needs_review=needs_review,
                created_at=now - timedelta(days=10, minutes=index),
            )
        )

    completion_counts = [4, 7, 10, 8, 13, 11, 8]
    completed_titles = [
        "Review capture transcript",
        "Send follow-up note",
        "Archive old task cards",
        "Plan weekly chores",
        "Check reminder delivery",
        "Update project notes",
        "Confirm invoices",
        "Water indoor plants",
        "Triage inbox tasks",
        "Clean kitchen counters",
        "Schedule dentist reminder",
        "Review dashboard metrics",
        "Prepare meeting brief",
    ]
    completed_index = 0
    for day_offset, count in enumerate(completion_counts):
        completed_date = today + timedelta(days=day_offset)
        for count_index in range(count):
            title = completed_titles[completed_index % len(completed_titles)]
            group_name = ("Inbox", "Chores", "Jobs")[completed_index % 3]
            completed_at = datetime.combine(
                completed_date,
                time(hour=9 + (count_index % 8), minute=(count_index * 7) % 60),
                tzinfo=UTC,
            )
            rows.append(
                _task_row(
                    user_id=user_id,
                    group_id=group_ids[group_name],
                    title=f"{title} {completed_index + 1}",
                    status="completed",
                    due_date=completed_date,
                    needs_review=False,
                    completed_at=completed_at,
                    created_at=completed_at - timedelta(days=2),
                )
            )
            completed_index += 1

    connection.execute(tasks.insert(), rows)
    return len(rows)


def _task_row(
    *,
    user_id: str,
    group_id: str,
    title: str,
    status: str,
    due_date: date | None,
    needs_review: bool,
    created_at: datetime,
    completed_at: datetime | None = None,
) -> dict[str, object]:
    return {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "group_id": group_id,
        "capture_id": None,
        "series_id": None,
        "title": title,
        "description": SEED_MARKER,
        "status": status,
        "needs_review": needs_review,
        "due_date": due_date,
        "reminder_at": None,
        "reminder_offset_minutes": None,
        "recurrence_frequency": None,
        "recurrence_interval": None,
        "recurrence_weekday": None,
        "recurrence_day_of_month": None,
        "recurrence_month": None,
        "completed_at": completed_at,
        "deleted_at": None,
        "created_at": created_at,
        "updated_at": created_at,
    }


if __name__ == "__main__":
    main(only_if_empty="--if-empty" in sys.argv[1:])
