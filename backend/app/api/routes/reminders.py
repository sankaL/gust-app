from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.dependencies import get_reminder_worker_service, require_internal_job_secret
from app.services.reminders import ReminderWorkerService

router = APIRouter()

ReminderWorkerServiceDep = Annotated[ReminderWorkerService, Depends(get_reminder_worker_service)]
InternalJobSecretDep = Annotated[None, Depends(require_internal_job_secret)]


class RunRemindersResponse(BaseModel):
    claimed: int
    sent: int
    cancelled: int
    requeued: int
    failed: int
    captures_deleted: int


@router.post("/run", response_model=RunRemindersResponse)
async def run_due_reminders(
    _job_secret: InternalJobSecretDep,
    reminder_worker_service: ReminderWorkerServiceDep,
) -> RunRemindersResponse:
    summary = await reminder_worker_service.run_due_work()
    return RunRemindersResponse(**summary.to_dict())
