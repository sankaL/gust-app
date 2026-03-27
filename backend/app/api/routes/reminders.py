from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.core.dependencies import get_reminder_worker_service, require_internal_job_secret
from app.services.reminders import DigestMode, ReminderWorkerService

router = APIRouter()

ReminderWorkerServiceDep = Annotated[ReminderWorkerService, Depends(get_reminder_worker_service)]
InternalJobSecretDep = Annotated[None, Depends(require_internal_job_secret)]


class RunRemindersResponse(BaseModel):
    mode: DigestMode
    users_processed: int
    sent: int
    skipped_empty: int
    failed: int
    captures_deleted: int


@router.post("/run", response_model=RunRemindersResponse)
async def run_due_reminders(
    _job_secret: InternalJobSecretDep,
    reminder_worker_service: ReminderWorkerServiceDep,
    mode: Annotated[DigestMode, Query(...)],
) -> RunRemindersResponse:
    summary = await reminder_worker_service.run_due_work(mode=mode)
    return RunRemindersResponse(**summary.to_dict())
