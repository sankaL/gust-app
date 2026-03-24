from __future__ import annotations

from datetime import date
# ruff: noqa: UP045
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, UploadFile, status
from pydantic import BaseModel

from app.core.dependencies import (
    get_capture_service,
    get_current_session_context,
    get_staging_service,
    require_csrf,
)
from app.db.repositories import SessionContext
from app.services.capture import CaptureService, ReviewCaptureResult, SubmitCaptureResult
from app.services.staging import StagingService

router = APIRouter()

CaptureServiceDep = Annotated[CaptureService, Depends(get_capture_service)]
StagingServiceDep = Annotated[StagingService, Depends(get_staging_service)]
RequiredSessionContextDep = Annotated[SessionContext, Depends(require_csrf)]
AuthenticatedSessionContextDep = Annotated[SessionContext, Depends(get_current_session_context)]


class TextCaptureRequest(BaseModel):
    text: str


class SubmitCaptureRequest(BaseModel):
    transcript_text: str


class CaptureReviewResponse(BaseModel):
    capture_id: str
    status: str
    transcript_text: str


class SkippedCaptureItemResponse(BaseModel):
    code: str
    message: str
    title: Optional[str] = None


class SubmitCaptureResponse(BaseModel):
    capture_id: str
    status: str
    tasks_created_count: int
    tasks_flagged_for_review_count: int
    tasks_skipped_count: int
    zero_actionable: bool
    skipped_items: list[SkippedCaptureItemResponse]


class ExtractedTaskResponse(BaseModel):
    id: str
    capture_id: str
    title: str
    group_id: str
    group_name: Optional[str]
    due_date: Optional[str]
    reminder_at: Optional[str]
    recurrence_frequency: Optional[str]
    recurrence_weekday: Optional[int]
    recurrence_day_of_month: Optional[int]
    top_confidence: float
    needs_review: bool
    status: str
    created_at: str
    updated_at: str


class ReExtractRequest(BaseModel):
    transcript_text: str


class UpdateExtractedTaskRequest(BaseModel):
    due_date: Optional[date] = None


@router.post("/voice", response_model=CaptureReviewResponse, status_code=status.HTTP_201_CREATED)
async def create_voice_capture(
    audio: Annotated[UploadFile, File(...)],
    session_context: RequiredSessionContextDep,
    capture_service: CaptureServiceDep,
) -> CaptureReviewResponse:
    content = await audio.read()
    result = await capture_service.create_voice_capture(
        user_id=session_context.user.id,
        audio_bytes=content,
        filename=audio.filename or "capture.webm",
        content_type=audio.content_type or "application/octet-stream",
    )
    return _build_review_response(result)


@router.post("/text", response_model=CaptureReviewResponse, status_code=status.HTTP_201_CREATED)
async def create_text_capture(
    payload: TextCaptureRequest,
    session_context: RequiredSessionContextDep,
    capture_service: CaptureServiceDep,
) -> CaptureReviewResponse:
    result = await capture_service.create_text_capture(
        user_id=session_context.user.id,
        text=payload.text,
    )
    return _build_review_response(result)


@router.post("/{capture_id}/submit", response_model=SubmitCaptureResponse)
async def submit_capture(
    capture_id: str,
    payload: SubmitCaptureRequest,
    session_context: RequiredSessionContextDep,
    capture_service: CaptureServiceDep,
) -> SubmitCaptureResponse:
    result = await capture_service.submit_capture(
        user_id=session_context.user.id,
        capture_id=capture_id,
        transcript_text=payload.transcript_text,
    )
    return _build_submit_response(result)


def _build_review_response(result: ReviewCaptureResult) -> CaptureReviewResponse:
    return CaptureReviewResponse(
        capture_id=result.capture_id,
        status=result.status,
        transcript_text=result.transcript_text,
    )


def _build_submit_response(result: SubmitCaptureResult) -> SubmitCaptureResponse:
    return SubmitCaptureResponse(
        capture_id=result.capture_id,
        status=result.status,
        tasks_created_count=result.tasks_created_count,
        tasks_flagged_for_review_count=result.tasks_flagged_for_review_count,
        tasks_skipped_count=result.tasks_skipped_count,
        zero_actionable=result.zero_actionable,
        skipped_items=[
            SkippedCaptureItemResponse(code=item.code, message=item.message, title=item.title)
            for item in result.skipped_items
        ],
    )


def _build_extracted_task_response(task) -> ExtractedTaskResponse:
    return ExtractedTaskResponse(
        id=task.id,
        capture_id=task.capture_id,
        title=task.title,
        group_id=task.group_id,
        group_name=task.group_name,
        due_date=task.due_date.isoformat() if task.due_date else None,
        reminder_at=task.reminder_at.isoformat() if task.reminder_at else None,
        recurrence_frequency=task.recurrence_frequency,
        recurrence_weekday=task.recurrence_weekday,
        recurrence_day_of_month=task.recurrence_day_of_month,
        top_confidence=task.top_confidence,
        needs_review=task.needs_review,
        status=task.status,
        created_at=task.created_at.isoformat(),
        updated_at=task.updated_at.isoformat(),
    )


@router.get("/{capture_id}/extracted-tasks", response_model=list[ExtractedTaskResponse])
async def list_extracted_tasks(
    capture_id: str,
    session_context: AuthenticatedSessionContextDep,
    staging_service: StagingServiceDep,
) -> list[ExtractedTaskResponse]:
    extracted_tasks = await staging_service.list_extracted_tasks(
        user_id=session_context.user.id,
        capture_id=capture_id,
        status="pending",
    )
    return [_build_extracted_task_response(task) for task in extracted_tasks]


@router.post("/{capture_id}/extracted-tasks/{task_id}/approve", response_model=ExtractedTaskResponse)
async def approve_extracted_task(
    capture_id: str,
    task_id: str,
    session_context: RequiredSessionContextDep,
    staging_service: StagingServiceDep,
) -> ExtractedTaskResponse:
    await staging_service.approve_task(
        user_id=session_context.user.id,
        capture_id=capture_id,
        extracted_task_id=task_id,
    )
    # Fetch the approved extracted task to return the full response
    approved_task = await staging_service.get_extracted_task(
        user_id=session_context.user.id,
        extracted_task_id=task_id,
    )
    return _build_extracted_task_response(approved_task)


@router.post("/{capture_id}/extracted-tasks/{task_id}/discard", status_code=status.HTTP_200_OK)
async def discard_extracted_task(
    capture_id: str,
    task_id: str,
    session_context: RequiredSessionContextDep,
    staging_service: StagingServiceDep,
) -> dict[str, bool]:
    await staging_service.discard_task(
        user_id=session_context.user.id,
        capture_id=capture_id,
        extracted_task_id=task_id,
    )
    return {"discarded": True}


@router.patch("/{capture_id}/extracted-tasks/{task_id}", response_model=ExtractedTaskResponse)
async def update_extracted_task(
    capture_id: str,
    task_id: str,
    payload: UpdateExtractedTaskRequest,
    session_context: RequiredSessionContextDep,
    staging_service: StagingServiceDep,
) -> ExtractedTaskResponse:
    """Update an extracted task (e.g., due_date)."""
    updated_task = await staging_service.update_task_due_date(
        user_id=session_context.user.id,
        capture_id=capture_id,
        extracted_task_id=task_id,
        due_date=payload.due_date,
    )
    return _build_extracted_task_response(updated_task)


@router.post("/{capture_id}/extracted-tasks/approve-all", response_model=list[ExtractedTaskResponse])
async def approve_all_extracted_tasks(
    capture_id: str,
    session_context: RequiredSessionContextDep,
    staging_service: StagingServiceDep,
) -> list[ExtractedTaskResponse]:
    await staging_service.approve_all(
        user_id=session_context.user.id,
        capture_id=capture_id,
    )
    # Fetch all approved extracted tasks to return the full responses
    approved_tasks = await staging_service.list_extracted_tasks(
        user_id=session_context.user.id,
        capture_id=capture_id,
        status="approved",
    )
    return [_build_extracted_task_response(task) for task in approved_tasks]


@router.post("/{capture_id}/extracted-tasks/discard-all", status_code=status.HTTP_200_OK)
async def discard_all_extracted_tasks(
    capture_id: str,
    session_context: RequiredSessionContextDep,
    staging_service: StagingServiceDep,
) -> dict[str, int]:
    count = await staging_service.discard_all(
        user_id=session_context.user.id,
        capture_id=capture_id,
    )
    return {"discarded_count": count}


@router.post("/{capture_id}/re-extract", response_model=list[ExtractedTaskResponse])
async def re_extract_capture(
    capture_id: str,
    payload: ReExtractRequest,
    session_context: RequiredSessionContextDep,
    capture_service: CaptureServiceDep,
    staging_service: StagingServiceDep,
) -> list[ExtractedTaskResponse]:
    await capture_service.re_extract_capture(
        user_id=session_context.user.id,
        capture_id=capture_id,
        transcript_text=payload.transcript_text,
    )
    # Fetch the newly extracted (pending) tasks from staging
    extracted_tasks = await staging_service.list_extracted_tasks(
        user_id=session_context.user.id,
        capture_id=capture_id,
        status="pending",
    )
    return [_build_extracted_task_response(task) for task in extracted_tasks]


class CompleteCaptureRequest(BaseModel):
    pass


@router.post("/{capture_id}/complete", status_code=status.HTTP_200_OK)
async def complete_capture(
    capture_id: str,
    session_context: RequiredSessionContextDep,
    capture_service: CaptureServiceDep,
) -> dict[str, str]:
    """Mark a capture as completed after all staging tasks are resolved.

    This endpoint transitions the capture status to 'completed', indicating
    that the user has finished reviewing and resolving all extracted tasks.
    """
    await capture_service.complete_capture(
        user_id=session_context.user.id,
        capture_id=capture_id,
    )
    return {"status": "completed"}


@router.get("/pending-tasks", response_model=list[ExtractedTaskResponse])
async def list_pending_tasks(
    session_context: AuthenticatedSessionContextDep,
    staging_service: StagingServiceDep,
) -> list[ExtractedTaskResponse]:
    """List all pending extracted tasks for the current user.

    This endpoint returns pending tasks across ALL captures, enabling a persistent
    pending list that accumulates over time until the user approves or discards each task.
    """
    extracted_tasks = await staging_service.list_extracted_tasks(
        user_id=session_context.user.id,
        status="pending",
    )
    return [_build_extracted_task_response(task) for task in extracted_tasks]
