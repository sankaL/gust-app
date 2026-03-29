from __future__ import annotations

# ruff: noqa: UP045
import sqlite3
from dataclasses import dataclass

import sqlalchemy as sa

from app.core.errors import ConflictError, GroupNotFoundError, InvalidGroupError
from app.core.input_safety import (
    MAX_GROUP_DESCRIPTION_CHARS,
    MAX_TITLE_CHARS,
    validate_optional_plain_text,
    validate_plain_text,
)
from app.core.settings import Settings
from app.db.engine import user_connection_scope
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
    name: str | None = None
    description: str | None = None
    description_provided: bool = False


class GroupService:
    def __init__(self, *, settings: Settings, task_service: TaskService) -> None:
        self.settings = settings
        self.task_service = task_service

    def list_groups(self, *, user_id: str) -> list[GroupSummaryRecord]:
        with user_connection_scope(self.settings.database_url, user_id=user_id) as connection:
            return list_groups_with_counts(connection, user_id=user_id)

    def create_group(
        self,
        *,
        user_id: str,
        name: str,
        description: str | None,
    ) -> GroupRecord:
        try:
            normalized_name = validate_plain_text(
                name,
                field_name="Group name",
                max_length=MAX_TITLE_CHARS,
            )
            normalized_description = validate_optional_plain_text(
                description,
                field_name="Group description",
                max_length=MAX_GROUP_DESCRIPTION_CHARS,
            )
        except ValueError as exc:
            raise InvalidGroupError(str(exc)) from exc

        with user_connection_scope(self.settings.database_url, user_id=user_id) as connection:
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
        with user_connection_scope(self.settings.database_url, user_id=user_id) as connection:
            existing = get_group(connection, user_id=user_id, group_id=group_id)
            if existing is None:
                raise GroupNotFoundError()
            if existing.is_system:
                raise InvalidGroupError("System groups cannot be edited in v1.")

            values: dict[str, object] = {}
            if payload.name is not None:
                try:
                    values["name"] = validate_plain_text(
                        payload.name,
                        field_name="Group name",
                        max_length=MAX_TITLE_CHARS,
                    )
                except ValueError as exc:
                    raise InvalidGroupError(str(exc)) from exc
            if payload.description_provided:
                try:
                    values["description"] = validate_optional_plain_text(
                        payload.description,
                        field_name="Group description",
                        max_length=MAX_GROUP_DESCRIPTION_CHARS,
                    )
                except ValueError as exc:
                    raise InvalidGroupError(str(exc)) from exc
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

        with user_connection_scope(self.settings.database_url, user_id=user_id) as connection:
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
