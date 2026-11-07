"""Bearer-token verification for the MCP endpoint.

The SDK's auth middleware calls `verify_token` for every request. A valid token becomes an
`AccessToken` whose claims carry the principal, and tools read it back with
`current_principal()`. Anything missing or malformed fails closed.
"""

from __future__ import annotations

from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.provider import AccessToken
from mcp.server.mcpserver.exceptions import ToolError

from app.core.concurrency import run_blocking
from app.services.agent_access import AgentAccessService, McpPrincipal

# The SDK keeps the AccessToken in a request contextvar. Never keep the plaintext there.
REDACTED_TOKEN = "[redacted]"


class GustTokenVerifier:
    def __init__(self, agent_access_service: AgentAccessService) -> None:
        self.agent_access_service = agent_access_service

    async def verify_token(self, token: str) -> AccessToken | None:
        # Token resolution reads the database, so it runs off the event loop.
        principal = await run_blocking(self.agent_access_service.resolve_bearer_token, token)
        if principal is None:
            return None
        return AccessToken(
            token=REDACTED_TOKEN,
            client_id=principal.token_id,
            subject=principal.user_id,
            scopes=principal.scopes,
            claims={
                "gust_user_id": principal.user_id,
                "gust_token_id": principal.token_id,
                "gust_access_level": principal.access_level,
                "gust_timezone": principal.timezone,
                "gust_inbox_group_id": principal.inbox_group_id,
            },
        )


def current_principal() -> McpPrincipal:
    """The principal for the MCP request being handled. Raises a tool error when there is none,
    which only happens if auth was bypassed, so the call fails closed."""
    access_token = get_access_token()
    claims = access_token.claims if access_token is not None else None
    if not claims:
        raise ToolError("Authentication is required.")
    try:
        principal = McpPrincipal(
            user_id=str(claims["gust_user_id"]),
            token_id=str(claims["gust_token_id"]),
            access_level=str(claims["gust_access_level"]),
            timezone=str(claims["gust_timezone"]),
            inbox_group_id=str(claims["gust_inbox_group_id"]),
        )
    except KeyError:
        raise ToolError("Authentication is required.") from None
    if principal.user_id != access_token.subject or principal.token_id != access_token.client_id:
        raise ToolError("Authentication is required.")
    return principal
