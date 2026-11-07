"""Settings → Agent access (MCP). Browser session only: a token can never manage tokens."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel, Field

from app.core.dependencies import (
    get_agent_access_service,
    get_current_session_context,
    require_csrf,
)
from app.db.mcp_repositories import McpAccessTokenRecord
from app.db.repositories import SessionContext
from app.services.agent_access import (
    EXPIRY_DAY_CHOICES,
    MAX_TOKEN_NAME_CHARS,
    AgentAccessOverview,
    AgentAccessService,
)

router = APIRouter()

SessionDep = Annotated[SessionContext, Depends(get_current_session_context)]
CsrfSessionDep = Annotated[SessionContext, Depends(require_csrf)]
AgentAccessServiceDep = Annotated[AgentAccessService, Depends(get_agent_access_service)]


class AgentTokenResponse(BaseModel):
    id: str
    name: str
    token_prefix: str
    access_level: Literal["read", "read_write"]
    created_at: datetime
    expires_at: datetime
    last_used_at: datetime | None


class AgentAccessResponse(BaseModel):
    available: bool
    enabled: bool
    endpoint_url: str | None
    max_active_tokens: int
    expiry_day_choices: list[int]
    tokens: list[AgentTokenResponse]


class UpdateAgentAccessRequest(BaseModel):
    enabled: bool


class CreateAgentTokenRequest(BaseModel):
    name: str = Field(min_length=1, max_length=MAX_TOKEN_NAME_CHARS)
    access_level: Literal["read", "read_write"]
    expires_in_days: int


class CreatedAgentTokenResponse(BaseModel):
    token: AgentTokenResponse
    secret: str = Field(description="Shown once. Gust stores only a hash of it.")


class AgentActivityResponseItem(BaseModel):
    id: str
    tool_name: str
    outcome: Literal["ok", "error", "denied"]
    error_code: str | None
    target_type: str | None
    target_id: str | None
    target_label: str | None
    target_count: int
    token_name: str | None
    created_at: datetime


class AgentActivityResponse(BaseModel):
    items: list[AgentActivityResponseItem]


def _token_response(record: McpAccessTokenRecord) -> AgentTokenResponse:
    return AgentTokenResponse(
        id=record.id,
        name=record.name,
        token_prefix=record.token_prefix,
        access_level=record.access_level,  # type: ignore[arg-type]
        created_at=record.created_at,
        expires_at=record.expires_at,
        last_used_at=record.last_used_at,
    )


def _overview_response(overview: AgentAccessOverview) -> AgentAccessResponse:
    return AgentAccessResponse(
        available=overview.available,
        enabled=overview.enabled,
        endpoint_url=overview.endpoint_url,
        max_active_tokens=overview.max_active_tokens,
        expiry_day_choices=list(EXPIRY_DAY_CHOICES),
        tokens=[_token_response(token) for token in overview.tokens],
    )


@router.get("", response_model=AgentAccessResponse)
def get_agent_access(
    session_context: SessionDep,
    service: AgentAccessServiceDep,
) -> AgentAccessResponse:
    return _overview_response(service.get_overview(user_id=session_context.user.id))


@router.put("", response_model=AgentAccessResponse)
def update_agent_access(
    payload: UpdateAgentAccessRequest,
    session_context: CsrfSessionDep,
    service: AgentAccessServiceDep,
) -> AgentAccessResponse:
    overview = service.set_enabled(user_id=session_context.user.id, enabled=payload.enabled)
    return _overview_response(overview)


@router.post(
    "/tokens",
    response_model=CreatedAgentTokenResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_agent_token(
    payload: CreateAgentTokenRequest,
    response: Response,
    session_context: CsrfSessionDep,
    service: AgentAccessServiceDep,
) -> CreatedAgentTokenResponse:
    created = service.create_token(
        user_id=session_context.user.id,
        name=payload.name,
        access_level=payload.access_level,
        expires_in_days=payload.expires_in_days,
    )
    # The secret appears in this one response only. Keep it out of every cache.
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    return CreatedAgentTokenResponse(
        token=_token_response(created.record),
        secret=created.plaintext,
    )


@router.delete("/tokens/{token_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_agent_token(
    token_id: str,
    session_context: CsrfSessionDep,
    service: AgentAccessServiceDep,
) -> Response:
    service.revoke_token(user_id=session_context.user.id, token_id=token_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/activity", response_model=AgentActivityResponse)
def list_agent_activity(
    session_context: SessionDep,
    service: AgentAccessServiceDep,
) -> AgentActivityResponse:
    items = service.list_activity(user_id=session_context.user.id)
    return AgentActivityResponse(
        items=[
            AgentActivityResponseItem(
                id=item.id,
                tool_name=item.tool_name,
                outcome=item.outcome,  # type: ignore[arg-type]
                error_code=item.error_code,
                target_type=item.target_type,
                target_id=item.target_id,
                target_label=item.target_label,
                target_count=item.target_count,
                token_name=item.token_name,
                created_at=item.created_at,
            )
            for item in items
        ]
    )
