from __future__ import annotations

import sqlalchemy as sa

from app.db.engine import connection_scope
from app.db.schema import groups, tasks, users
from app.dev import seed_auth, seed_dashboard
from app.services.auth import LocalDevAuthService


def test_local_dev_seed_bootstraps_user_inbox_and_dashboard_fixture(
    app,
    monkeypatch,
) -> None:
    settings = app.state.settings
    settings.gust_dev_mode = True
    settings.local_dev_auth_secret = "test-local-dev-secret-that-is-at-least-32-characters"
    monkeypatch.setattr(seed_auth, "get_settings", lambda: settings)
    monkeypatch.setattr(seed_dashboard, "get_settings", lambda: settings)

    seed_auth.main()
    seed_dashboard.main(only_if_empty=True)

    with connection_scope(settings.database_url) as connection:
        user = connection.execute(
            sa.select(users).where(users.c.id == LocalDevAuthService.USER_ID)
        ).one()
        inbox = connection.execute(
            sa.select(groups).where(
                groups.c.user_id == LocalDevAuthService.USER_ID,
                groups.c.system_key == "inbox",
            )
        ).one()
        task_count = connection.execute(
            sa.select(sa.func.count()).select_from(tasks).where(
                tasks.c.user_id == LocalDevAuthService.USER_ID
            )
        ).scalar_one()

    assert user.email == LocalDevAuthService.EMAIL
    assert inbox.name == "Inbox"
    assert task_count > 0


def test_local_dev_dashboard_seed_preserves_existing_tasks(app, monkeypatch) -> None:
    settings = app.state.settings
    settings.gust_dev_mode = True
    settings.local_dev_auth_secret = "test-local-dev-secret-that-is-at-least-32-characters"
    monkeypatch.setattr(seed_auth, "get_settings", lambda: settings)
    monkeypatch.setattr(seed_dashboard, "get_settings", lambda: settings)

    seed_auth.main()
    seed_dashboard.main(only_if_empty=True)

    with connection_scope(settings.database_url) as connection:
        before_count = connection.execute(
            sa.select(sa.func.count()).select_from(tasks)
        ).scalar_one()

    seed_dashboard.main(only_if_empty=True)

    with connection_scope(settings.database_url) as connection:
        after_count = connection.execute(sa.select(sa.func.count()).select_from(tasks)).scalar_one()

    assert after_count == before_count
