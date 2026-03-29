from __future__ import annotations

# ruff: noqa: UP045
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, field_validator

from app.core.dependencies import get_current_session_context, get_group_service, require_csrf
from app.core.input_safety import (
    MAX_GROUP_DESCRIPTION_CHARS,
    MAX_TITLE_CHARS,
    validate_optional_plain_text,
    validate_plain_text,
)
from app.db.repositories import GroupRecord, GroupSummaryRecord, SessionContext
from app.services.group_service import GroupService, GroupUpdateInput

router = APIRouter()

GroupServiceDep = Annotated[GroupService, Depends(get_group_service)]
OptionalSessionContextDep = Annotated[SessionContext, Depends(get_current_session_context)]
RequiredSessionContextDep = Annotated[SessionContext, Depends(require_csrf)]


class GroupResponse(BaseModel):
    id: str
    name: str
    description: Optional[str]
    is_system: bool
    system_key: Optional[str]
    open_task_count: int


class CreateGroupRequest(BaseModel):
    name: str
    description: Optional[str] = None

    @field_validator("name")
    @classmethod
    def _validate_name(cls, value: str) -> str:
        return validate_plain_text(value, field_name="Group name", max_length=MAX_TITLE_CHARS)

    @field_validator("description")
    @classmethod
    def _validate_description(cls, value: Optional[str]) -> Optional[str]:
        return validate_optional_plain_text(
            value,
            field_name="Group description",
            max_length=MAX_GROUP_DESCRIPTION_CHARS,
        )


class UpdateGroupRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

    @field_validator("name")
    @classmethod
    def _validate_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return validate_plain_text(value, field_name="Group name", max_length=MAX_TITLE_CHARS)

    @field_validator("description")
    @classmethod
    def _validate_description(cls, value: Optional[str]) -> Optional[str]:
        return validate_optional_plain_text(
            value,
            field_name="Group description",
            max_length=MAX_GROUP_DESCRIPTION_CHARS,
        )


class DeleteGroupRequest(BaseModel):
    destination_group_id: str


@router.get("", response_model=list[GroupResponse])
def list_groups(
    session_context: OptionalSessionContextDep,
    group_service: GroupServiceDep,
) -> list[GroupResponse]:
    groups = group_service.list_groups(user_id=session_context.user.id)
    return [_build_group_response(group) for group in groups]


@router.post("", response_model=GroupResponse, status_code=status.HTTP_201_CREATED)
def create_group_route(
    payload: CreateGroupRequest,
    session_context: RequiredSessionContextDep,
    group_service: GroupServiceDep,
) -> GroupResponse:
    group = group_service.create_group(
        user_id=session_context.user.id,
        name=payload.name,
        description=payload.description,
    )
    return _build_group_response(group)


@router.patch("/{group_id}", response_model=GroupResponse)
def update_group_route(
    group_id: str,
    payload: UpdateGroupRequest,
    session_context: RequiredSessionContextDep,
    group_service: GroupServiceDep,
) -> GroupResponse:
    group = group_service.update_group(
        user_id=session_context.user.id,
        group_id=group_id,
        payload=GroupUpdateInput(
            name=payload.name,
            description=payload.description,
            description_provided="description" in payload.model_fields_set,
        ),
    )
    return _build_group_response(group)


@router.delete("/{group_id}", response_model=dict[str, bool])
def delete_group_route(
    group_id: str,
    payload: DeleteGroupRequest,
    session_context: RequiredSessionContextDep,
    group_service: GroupServiceDep,
) -> dict[str, bool]:
    group_service.delete_group(
        user_id=session_context.user.id,
        group_id=group_id,
        destination_group_id=payload.destination_group_id,
    )
    return {"deleted": True}


def _build_group_response(group: GroupRecord | GroupSummaryRecord) -> GroupResponse:
    return GroupResponse(
        id=group.id,
        name=group.name,
        description=group.description,
        is_system=group.is_system,
        system_key=group.system_key,
        open_task_count=getattr(group, "open_task_count", 0),
    )
