from __future__ import annotations

# ruff: noqa: UP045
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, UploadFile, status
from pydantic import BaseModel

from app.core.dependencies import get_capture_service, require_csrf
from app.db.repositories import SessionContext
from app.services.capture import CaptureService, ReviewCaptureResult, SubmitCaptureResult

router = APIRouter()

CaptureServiceDep = Annotated[CaptureService, Depends(get_capture_service)]
RequiredSessionContextDep = Annotated[SessionContext, Depends(require_csrf)]


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
