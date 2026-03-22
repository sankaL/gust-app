from __future__ import annotations

import pytest
import sqlalchemy as sa

from app.db.engine import connection_scope
from app.db.repositories import (
    ensure_inbox_group,
    get_session_context,
    update_user_timezone,
    upsert_user,
)
from app.db.schema import tasks


def test_user_upsert_and_inbox_bootstrap_are_idempotent(client) -> None:
    database_url = client.app.state.settings.database_url

    with connection_scope(database_url) as connection:
        first_user = upsert_user(
            connection,
            user_id="11111111-1111-1111-1111-111111111111",
            email="user@example.com",
            display_name="First Name",
            timezone="UTC",
        )
        second_user = upsert_user(
            connection,
            user_id="11111111-1111-1111-1111-111111111111",
            email="updated@example.com",
            display_name="Updated Name",
            timezone="America/Toronto",
        )
        inbox_first = ensure_inbox_group(connection, user_id=first_user.id)
        inbox_second = ensure_inbox_group(connection, user_id=first_user.id)

    assert second_user.email == "updated@example.com"
    assert second_user.timezone == "America/Toronto"
    assert inbox_first.id == inbox_second.id


def test_timezone_update_and_session_context_are_user_scoped(client) -> None:
    database_url = client.app.state.settings.database_url

    with connection_scope(database_url) as connection:
        upsert_user(
            connection,
            user_id="11111111-1111-1111-1111-111111111111",
            email="user@example.com",
            display_name="User One",
            timezone="UTC",
        )
        upsert_user(
            connection,
            user_id="22222222-2222-2222-2222-222222222222",
            email="other@example.com",
            display_name="User Two",
            timezone="UTC",
        )
        ensure_inbox_group(connection, user_id="11111111-1111-1111-1111-111111111111")
        ensure_inbox_group(connection, user_id="22222222-2222-2222-2222-222222222222")
        updated_user = update_user_timezone(
            connection,
            user_id="11111111-1111-1111-1111-111111111111",
            timezone="America/Toronto",
        )
        first_context = get_session_context(connection, "11111111-1111-1111-1111-111111111111")
        second_context = get_session_context(connection, "22222222-2222-2222-2222-222222222222")

    assert updated_user is not None
    assert updated_user.timezone == "America/Toronto"
    assert first_context is not None
    assert first_context.user.timezone == "America/Toronto"
    assert second_context is not None
    assert second_context.user.timezone == "UTC"
    assert first_context.inbox_group_id != second_context.inbox_group_id


def test_task_group_id_is_non_null_at_schema_level(client) -> None:
    database_url = client.app.state.settings.database_url

    with connection_scope(database_url) as connection:
        upsert_user(
            connection,
            user_id="11111111-1111-1111-1111-111111111111",
            email="user@example.com",
            display_name="User One",
            timezone="UTC",
        )
        ensure_inbox_group(connection, user_id="11111111-1111-1111-1111-111111111111")

        with pytest.raises(sa.exc.IntegrityError):
            connection.execute(
                tasks.insert().values(
                    id="44444444-4444-4444-4444-444444444444",
                    user_id="11111111-1111-1111-1111-111111111111",
                    group_id=None,
                    capture_id=None,
                    series_id=None,
                    title="Task without group",
                    status="open",
                    needs_review=False,
                )
            )
