"""Re-encrypt stored Pushover user keys with the current encryption key.

Rotation flow (see docs/backend-database-migration-runbook.md):
1. Deploy with PUSHOVER_CREDENTIAL_ENCRYPTION_KEY=<new> and
   PUSHOVER_PREVIOUS_CREDENTIAL_ENCRYPTION_KEYS=<old>.
2. Run this module (dry run by default, then with --apply).
3. Remove PUSHOVER_PREVIOUS_CREDENTIAL_ENCRYPTION_KEYS and redeploy.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, field

import sqlalchemy as sa
from cryptography.fernet import Fernet, InvalidToken

from app.core.errors import ConfigurationError
from app.core.settings import Settings, get_settings
from app.db.engine import internal_job_connection_scope
from app.db.schema import notification_preferences
from app.services.pushover import PushoverService


@dataclass
class RotationResult:
    scanned: int = 0
    already_current: int = 0
    rotated: int = 0
    undecryptable_user_ids: list[str] = field(default_factory=list)
    applied: bool = False


def rotate_pushover_credentials(
    settings: Settings, *, apply: bool, database_url: str | None = None
) -> RotationResult:
    if not settings.pushover_credential_encryption_key:
        raise ConfigurationError("PUSHOVER_CREDENTIAL_ENCRYPTION_KEY is not configured.")
    if not settings.pushover_previous_credential_encryption_keys:
        raise ConfigurationError(
            "PUSHOVER_PREVIOUS_CREDENTIAL_ENCRYPTION_KEYS is not configured; nothing to rotate."
        )
    cipher = PushoverService(settings).credential_cipher()
    current = Fernet(settings.pushover_credential_encryption_key.encode())

    result = RotationResult()
    pending: list[tuple[str, str, str]] = []
    with internal_job_connection_scope(database_url or settings.database_url) as connection:
        rows = connection.execute(
            sa.select(
                notification_preferences.c.user_id,
                notification_preferences.c.pushover_user_key_encrypted,
            )
            .where(notification_preferences.c.pushover_user_key_encrypted.is_not(None))
            .with_for_update()
        ).all()
        for row in rows:
            result.scanned += 1
            token = row.pushover_user_key_encrypted.encode()
            try:
                current.decrypt(token)
                result.already_current += 1
                continue
            except InvalidToken:
                pass
            try:
                rotated = cipher.rotate(token).decode()
            except InvalidToken:
                result.undecryptable_user_ids.append(str(row.user_id))
                continue
            pending.append((str(row.user_id), row.pushover_user_key_encrypted, rotated))

        # Fail closed: any row no configured key can read means the key set is wrong.
        if not apply or result.undecryptable_user_ids:
            result.rotated = len(pending)
            return result

        for user_id, old_value, new_value in pending:
            updated = connection.execute(
                notification_preferences.update()
                .where(
                    notification_preferences.c.user_id == user_id,
                    notification_preferences.c.pushover_user_key_encrypted == old_value,
                )
                .values(pushover_user_key_encrypted=new_value)
            )
            if updated.rowcount != 1:
                raise RuntimeError("Pushover credential row changed during rotation; rolled back.")
        result.rotated = len(pending)
        result.applied = True
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--apply", action="store_true", help="Write changes. Without it, only reports counts."
    )
    args = parser.parse_args(argv)

    result = rotate_pushover_credentials(get_settings(), apply=args.apply)
    print(
        f"scanned={result.scanned} already_current={result.already_current} "
        f"{'rotated' if result.applied else 'would_rotate'}={result.rotated} "
        f"undecryptable={len(result.undecryptable_user_ids)}"
    )
    if result.undecryptable_user_ids:
        print(
            "No changes written. Rows no configured key can decrypt (user_id): "
            + ", ".join(result.undecryptable_user_ids)
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
