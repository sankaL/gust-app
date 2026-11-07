"""Per-user agent access over MCP: the Settings switch, access tokens, and bearer resolution.

A token belongs to one user and only ever acts as that user. Only its SHA-256 hash is stored;
the plaintext is returned once, when the token is created.
"""

from __future__ import annotations

import hashlib
import logging
import re
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

from app.core.errors import (
    AgentAccessDisabledError,
    AgentAccessUnavailableError,
    AgentTokenLimitError,
    AgentTokenNotFoundError,
    InvalidAgentTokenRequestError,
)
from app.core.input_safety import validate_plain_text
from app.core.settings import Settings
from app.db.engine import (
    internal_job_connection_scope,
    mcp_token_lookup_connection_scope,
    user_connection_scope,
)
from app.db.mcp_repositories import (
    McpAccessTokenRecord,
    audit_retention_cutoff,
    count_active_mcp_access_tokens,
    create_mcp_access_token,
    delete_expired_mcp_audit_events,
    find_mcp_access_token_by_hash,
    get_mcp_access_token,
    get_user_mcp_state,
    group_names_by_id,
    list_active_mcp_access_tokens,
    list_recent_mcp_audit_events,
    revoke_all_mcp_access_tokens,
    revoke_mcp_access_token,
    set_user_mcp_enabled,
    task_titles_by_id,
    touch_mcp_access_token,
)
from app.db.repositories import get_session_context, get_user, is_email_allowed

logger = logging.getLogger("gust.mcp")

TOKEN_PREFIX = "gust_mcp_"
# 32 random bytes encode to 43 URL-safe base64 characters.
TOKEN_SECRET_LENGTH = 43
TOKEN_PATTERN = re.compile(rf"^{TOKEN_PREFIX}[A-Za-z0-9_-]{{{TOKEN_SECRET_LENGTH}}}$")
DISPLAY_PREFIX_SECRET_CHARS = 4
MAX_ACTIVE_TOKENS = 5
MAX_TOKEN_NAME_CHARS = 60
EXPIRY_DAY_CHOICES = (30, 90, 365)
ACTIVITY_LIMIT = 20
LAST_USED_WRITE_INTERVAL = timedelta(minutes=1)
AUDIT_PURGE_BATCH_SIZE = 500
# Up to 10,000 rows per digest run, each batch in its own short transaction.
AUDIT_PURGE_MAX_BATCHES = 20

AccessLevel = Literal["read", "read_write"]
ACCESS_LEVELS: tuple[str, ...] = ("read", "read_write")
SCOPE_READ = "gust:read"
SCOPE_WRITE = "gust:write"


@dataclass(frozen=True)
class GeneratedToken:
    plaintext: str
    display_prefix: str
    token_hash: str


@dataclass(frozen=True)
class McpPrincipal:
    """Who an MCP request acts as. Rebuilt from the verified bearer token on every request."""

    user_id: str
    token_id: str
    access_level: str
    timezone: str
    inbox_group_id: str

    @property
    def can_write(self) -> bool:
        return self.access_level == "read_write"

    @property
    def scopes(self) -> list[str]:
        return [SCOPE_READ, SCOPE_WRITE] if self.can_write else [SCOPE_READ]


@dataclass(frozen=True)
class AgentAccessOverview:
    available: bool
    enabled: bool
    endpoint_url: str | None
    max_active_tokens: int
    tokens: list[McpAccessTokenRecord]


@dataclass(frozen=True)
class CreatedAgentToken:
    record: McpAccessTokenRecord
    plaintext: str


@dataclass(frozen=True)
class AgentActivityItem:
    id: str
    tool_name: str
    outcome: str
    error_code: str | None
    target_type: str | None
    target_id: str | None
    target_label: str | None
    target_count: int
    token_name: str | None
    created_at: datetime


def generate_token() -> GeneratedToken:
    secret = secrets.token_urlsafe(32)
    if len(secret) != TOKEN_SECRET_LENGTH:  # pragma: no cover - token_urlsafe(32) is fixed width
        raise RuntimeError("Unexpected token length.")
    plaintext = f"{TOKEN_PREFIX}{secret}"
    return GeneratedToken(
        plaintext=plaintext,
        display_prefix=f"{TOKEN_PREFIX}{secret[:DISPLAY_PREFIX_SECRET_CHARS]}",
        token_hash=hash_token(plaintext),
    )


def hash_token(plaintext: str) -> str:
    return hashlib.sha256(plaintext.encode("utf-8")).hexdigest()


def is_well_formed_token(candidate: str) -> bool:
    return bool(TOKEN_PATTERN.fullmatch(candidate))


def _as_utc(value: datetime) -> datetime:
    # SQLite hands back naive datetimes; every stored timestamp is UTC.
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class AgentAccessService:
    def __init__(self, *, settings: Settings) -> None:
        self.settings = settings

    @property
    def available(self) -> bool:
        return self.settings.mcp_server_enabled

    def get_overview(self, *, user_id: str) -> AgentAccessOverview:
        now = datetime.now(UTC)
        with user_connection_scope(self.settings.database_url, user_id=user_id) as connection:
            state = get_user_mcp_state(connection, user_id=user_id)
            tokens = list_active_mcp_access_tokens(connection, user_id=user_id, now=now)
        return self._overview(enabled=bool(state and state.enabled), tokens=tokens)

    def set_enabled(self, *, user_id: str, enabled: bool) -> AgentAccessOverview:
        if enabled and not self.available:
            raise AgentAccessUnavailableError()
        now = datetime.now(UTC)
        with user_connection_scope(self.settings.database_url, user_id=user_id) as connection:
            state = get_user_mcp_state(connection, user_id=user_id, for_update=True)
            if state is None:
                raise AgentTokenNotFoundError("User could not be found.")
            if enabled and not state.enabled:
                set_user_mcp_enabled(connection, user_id=user_id, enabled=True, now=now)
            elif not enabled:
                # Turning access off revokes every token, so turning it back on never revives
                # a token that may have leaked in the meantime.
                revoked = revoke_all_mcp_access_tokens(connection, user_id=user_id, now=now)
                if state.enabled:
                    set_user_mcp_enabled(connection, user_id=user_id, enabled=False, now=now)
                if revoked:
                    logger.info(
                        "mcp_tokens_revoked",
                        extra={"event": "mcp_tokens_revoked", "reason": "disabled"},
                    )
            tokens = list_active_mcp_access_tokens(connection, user_id=user_id, now=now)
        return self._overview(enabled=enabled, tokens=tokens)

    def create_token(
        self,
        *,
        user_id: str,
        name: str,
        access_level: str,
        expires_in_days: int,
    ) -> CreatedAgentToken:
        if not self.available:
            raise AgentAccessUnavailableError()
        normalized_name = self._normalize_name(name)
        if access_level not in ACCESS_LEVELS:
            raise InvalidAgentTokenRequestError("Access must be `read` or `read_write`.")
        if expires_in_days not in EXPIRY_DAY_CHOICES:
            raise InvalidAgentTokenRequestError("Expiry must be 30, 90 or 365 days.")

        now = datetime.now(UTC)
        generated = generate_token()
        with user_connection_scope(self.settings.database_url, user_id=user_id) as connection:
            state = get_user_mcp_state(connection, user_id=user_id, for_update=True)
            if state is None or not state.enabled:
                raise AgentAccessDisabledError()
            if (
                count_active_mcp_access_tokens(connection, user_id=user_id, now=now)
                >= MAX_ACTIVE_TOKENS
            ):
                raise AgentTokenLimitError(MAX_ACTIVE_TOKENS)
            record = create_mcp_access_token(
                connection,
                user_id=user_id,
                name=normalized_name,
                token_prefix=generated.display_prefix,
                token_hash=generated.token_hash,
                access_level=access_level,
                created_at=now,
                expires_at=now + timedelta(days=expires_in_days),
            )
        logger.info(
            "mcp_token_created",
            extra={
                "event": "mcp_token_created",
                "token_id": record.id,
                "access_level": access_level,
                "expires_in_days": expires_in_days,
            },
        )
        return CreatedAgentToken(record=record, plaintext=generated.plaintext)

    def revoke_token(self, *, user_id: str, token_id: str) -> None:
        try:
            token_id = str(uuid.UUID(token_id))
        except ValueError:
            raise AgentTokenNotFoundError() from None
        now = datetime.now(UTC)
        with user_connection_scope(self.settings.database_url, user_id=user_id) as connection:
            if get_mcp_access_token(connection, user_id=user_id, token_id=token_id) is None:
                raise AgentTokenNotFoundError()
            revoke_mcp_access_token(connection, user_id=user_id, token_id=token_id, now=now)
        logger.info(
            "mcp_token_revoked",
            extra={"event": "mcp_token_revoked", "token_id": token_id, "reason": "user"},
        )

    def list_activity(
        self, *, user_id: str, limit: int = ACTIVITY_LIMIT
    ) -> list[AgentActivityItem]:
        with user_connection_scope(self.settings.database_url, user_id=user_id) as connection:
            events = list_recent_mcp_audit_events(connection, user_id=user_id, limit=limit)
            task_ids = [
                event.target_id
                for event in events
                if event.target_type == "task" and event.target_id is not None
            ]
            group_ids = [
                event.target_id
                for event in events
                if event.target_type == "group" and event.target_id is not None
            ]
            task_titles = task_titles_by_id(connection, user_id=user_id, task_ids=task_ids)
            group_names = group_names_by_id(connection, user_id=user_id, group_ids=group_ids)

        items: list[AgentActivityItem] = []
        for event in events:
            label: str | None = None
            if event.target_type == "task" and event.target_id is not None:
                label = task_titles.get(event.target_id)
            elif event.target_type == "group" and event.target_id is not None:
                label = group_names.get(event.target_id)
            target_count = len(event.target_ids) if event.target_ids else 0
            if not target_count and event.target_id is not None:
                target_count = 1
            items.append(
                AgentActivityItem(
                    id=event.id,
                    tool_name=event.tool_name,
                    outcome=event.outcome,
                    error_code=event.error_code,
                    target_type=event.target_type,
                    target_id=event.target_id,
                    target_label=label,
                    target_count=target_count,
                    token_name=event.token_name,
                    created_at=event.created_at,
                )
            )
        return items

    def resolve_bearer_token(self, candidate: str) -> McpPrincipal | None:
        """Return the principal for a valid token, or None. Fails closed at every step and
        never logs the token, its hash or its prefix."""
        if not is_well_formed_token(candidate):
            self._log_auth_failure("malformed")
            return None

        now = datetime.now(UTC)
        with mcp_token_lookup_connection_scope(self.settings.database_url) as connection:
            token = find_mcp_access_token_by_hash(connection, token_hash=hash_token(candidate))
        if token is None:
            self._log_auth_failure("unknown")
            return None
        if token.revoked_at is not None:
            self._log_auth_failure("revoked", token_id=token.id)
            return None
        if _as_utc(token.expires_at) <= now:
            self._log_auth_failure("expired", token_id=token.id)
            return None

        with user_connection_scope(self.settings.database_url, user_id=token.user_id) as connection:
            user = get_user(connection, token.user_id)
            if user is None:
                self._log_auth_failure("unknown_user", token_id=token.id)
                return None
            if not is_email_allowed(connection, email=user.email):
                self._log_auth_failure("not_allowlisted", token_id=token.id)
                return None
            state = get_user_mcp_state(connection, user_id=token.user_id)
            if state is None or not state.enabled:
                self._log_auth_failure("disabled", token_id=token.id)
                return None
            session_context = get_session_context(connection, token.user_id)
            if session_context is None:  # pragma: no cover - the user row was just read
                self._log_auth_failure("unknown_user", token_id=token.id)
                return None
            if (
                token.last_used_at is None
                or now - _as_utc(token.last_used_at) >= LAST_USED_WRITE_INTERVAL
            ):
                touch_mcp_access_token(
                    connection,
                    user_id=token.user_id,
                    token_id=token.id,
                    now=now,
                )

        return McpPrincipal(
            user_id=token.user_id,
            token_id=token.id,
            access_level=token.access_level,
            timezone=session_context.user.timezone,
            inbox_group_id=session_context.inbox_group_id,
        )

    def purge_expired_audit_events(self, *, now: datetime) -> int:
        cutoff = audit_retention_cutoff(now, retention_days=self.settings.mcp_audit_retention_days)
        deleted = 0
        for _ in range(AUDIT_PURGE_MAX_BATCHES):
            with internal_job_connection_scope(self.settings.database_url) as connection:
                batch = delete_expired_mcp_audit_events(
                    connection,
                    created_before=cutoff,
                    limit=AUDIT_PURGE_BATCH_SIZE,
                )
            deleted += batch
            if batch < AUDIT_PURGE_BATCH_SIZE:
                break
        return deleted

    def _overview(
        self, *, enabled: bool, tokens: list[McpAccessTokenRecord]
    ) -> AgentAccessOverview:
        return AgentAccessOverview(
            available=self.available,
            enabled=enabled,
            endpoint_url=self.settings.resolved_mcp_public_url if self.available else None,
            max_active_tokens=MAX_ACTIVE_TOKENS,
            tokens=tokens,
        )

    @staticmethod
    def _normalize_name(name: str) -> str:
        try:
            normalized = validate_plain_text(
                name,
                field_name="Token name",
                max_length=MAX_TOKEN_NAME_CHARS,
            )
        except ValueError as exc:
            raise InvalidAgentTokenRequestError(str(exc)) from exc
        if not normalized:
            raise InvalidAgentTokenRequestError("Token name is required.")
        return normalized

    @staticmethod
    def _log_auth_failure(reason: str, *, token_id: str | None = None) -> None:
        extra: dict[str, object] = {"event": "mcp_auth_failed", "reason": reason}
        if token_id is not None:
            extra["token_id"] = token_id
        logger.warning("mcp_auth_failed", extra=extra)
