from __future__ import annotations

import sqlalchemy as sa

from app.core.settings import get_settings
from app.db.engine import connection_scope, user_connection_scope
from app.db.repositories import ensure_inbox_group, get_user, upsert_user
from app.db.schema import allowed_users
from app.services.auth import LocalDevAuthService

LOCAL_DEV_AUTH_EMAIL = LocalDevAuthService.EMAIL


def main() -> None:
    settings = get_settings()
    if not settings.gust_dev_mode:
        raise RuntimeError("Refusing to seed local auth outside GUST_DEV_MODE=true.")

    with connection_scope(settings.database_url) as connection:
        exists = connection.execute(
            sa.select(allowed_users.c.email).where(
                sa.func.lower(allowed_users.c.email) == LOCAL_DEV_AUTH_EMAIL
            )
        ).first()
        if exists is None:
            connection.execute(allowed_users.insert().values(email=LOCAL_DEV_AUTH_EMAIL))

    with user_connection_scope(
        settings.database_url,
        user_id=LocalDevAuthService.USER_ID,
    ) as connection:
        existing_user = get_user(connection, LocalDevAuthService.USER_ID)
        upsert_user(
            connection,
            user_id=LocalDevAuthService.USER_ID,
            email=LOCAL_DEV_AUTH_EMAIL,
            display_name=LocalDevAuthService.DISPLAY_NAME,
            timezone=existing_user.timezone if existing_user is not None else "UTC",
        )
        ensure_inbox_group(connection, user_id=LocalDevAuthService.USER_ID)


if __name__ == "__main__":
    main()
