from __future__ import annotations

# ruff: noqa: UP045
import sqlite3
from dataclasses import dataclass
from typing import Optional

import sqlalchemy as sa

from app.core.errors import ConflictError, GroupNotFoundError, InvalidGroupError
from app.core.settings import Settings
from app.db.engine import connection_scope
from app.db.repositories import (
    GroupRecord,
    GroupSummaryRecord,
    create_group,
    delete_group,
    get_group,
    list_groups_with_counts,
    update_group,
)
from app.services.task_service import TaskService


@dataclass
class GroupUpdateInput:
    name: Optional[str] = None
    description: Optional[str] = None


class GroupService:
    def __init__(self, *, settings: Settings, task_service: TaskService) -> None:
        self.settings = settings
        self.task_service = task_service

    def list_groups(self, *, user_id: str) -> list[GroupSummaryRecord]:
        with connection_scope(self.settings.database_url) as connection:
            return list_groups_with_counts(connection, user_id=user_id)

    def create_group(
        self,
        *,
        user_id: str,
        name: str,
        description: Optional[str],
    ) -> GroupRecord:
        normalized_name = name.strip()
        if not normalized_name:
            raise InvalidGroupError("Group name cannot be blank.")

        normalized_description = description.strip() if description is not None else None
        if normalized_description == "":
            normalized_description = None

        with connection_scope(self.settings.database_url) as connection:
            try:
                return create_group(
                    connection,
                    user_id=user_id,
                    name=normalized_name,
                    description=normalized_description,
                )
            except sa.exc.IntegrityError as exc:
                raise self._map_group_conflict(exc) from exc

    def update_group(
        self,
        *,
        user_id: str,
        group_id: str,
        payload: GroupUpdateInput,
    ) -> GroupRecord:
        with connection_scope(self.settings.database_url) as connection:
            existing = get_group(connection, user_id=user_id, group_id=group_id)
            if existing is None:
                raise GroupNotFoundError()
            if existing.is_system:
                raise InvalidGroupError("System groups cannot be edited in v1.")

            values: dict[str, object] = {}
            if payload.name is not None:
                normalized_name = payload.name.strip()
                if not normalized_name:
                    raise InvalidGroupError("Group name cannot be blank.")
                values["name"] = normalized_name
            if payload.description is not None:
                normalized_description = payload.description.strip()
                values["description"] = normalized_description or None
            if not values:
                raise InvalidGroupError("At least one group field must be provided.")

            try:
                updated = update_group(
                    connection,
                    user_id=user_id,
                    group_id=group_id,
                    values=values,
                )
            except sa.exc.IntegrityError as exc:
                raise self._map_group_conflict(exc) from exc
            if updated is None:
                raise GroupNotFoundError()
            return updated

    def delete_group(
        self,
        *,
        user_id: str,
        group_id: str,
        destination_group_id: str,
    ) -> None:
        if destination_group_id == group_id:
            raise InvalidGroupError("Destination group must be different from the deleted group.")

        with connection_scope(self.settings.database_url) as connection:
            source = get_group(connection, user_id=user_id, group_id=group_id)
            if source is None:
                raise GroupNotFoundError()
            if source.is_system:
                raise InvalidGroupError("Inbox cannot be deleted in v1.")

            destination = get_group(connection, user_id=user_id, group_id=destination_group_id)
            if destination is None:
                raise GroupNotFoundError("Destination group could not be found.")

            self.task_service.reassign_tasks_for_deleted_group(
                connection=connection,
                user_id=user_id,
                source_group_id=group_id,
                destination_group_id=destination_group_id,
            )
            delete_group(connection, user_id=user_id, group_id=group_id)

    def _map_group_conflict(self, exc: sa.exc.IntegrityError) -> ConflictError:
        message = str(exc.orig) if exc.orig is not None else str(exc)
        if isinstance(exc.orig, sqlite3.IntegrityError) and "uq_groups_user_lower_name" in message:
            return ConflictError("group_name_conflict", "Group name already exists.")
        if "uq_groups_user_lower_name" in message or "groups.user_id, lower(name)" in message:
            return ConflictError("group_name_conflict", "Group name already exists.")
        return ConflictError("group_conflict", "Group update conflicts with existing data.")
