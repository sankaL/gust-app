import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.core.concurrency import run_blocking
from app.core.dependencies import get_reminder_worker_service, require_internal_job_secret
from app.services.reminders import DigestMode, ReminderRunSummary, ReminderWorkerService

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
    attempted: int = 0
    retried: int = 0
    skipped: int = 0


@router.post("/run", response_model=RunRemindersResponse)
async def run_due_reminders(
    _job_secret: InternalJobSecretDep,
    reminder_worker_service: ReminderWorkerServiceDep,
    mode: Annotated[DigestMode, Query(...)],
) -> RunRemindersResponse:
    summary = await run_blocking(_run_due_work_on_own_loop, reminder_worker_service, mode)
    return RunRemindersResponse(**summary.to_dict())


def _run_due_work_on_own_loop(
    reminder_worker_service: ReminderWorkerService,
    mode: DigestMode,
) -> ReminderRunSummary:
    # The worker interleaves blocking database calls with awaited provider requests. Giving it
    # its own event loop in a worker thread keeps those calls from stalling user requests.
    return asyncio.run(reminder_worker_service.run_due_work(mode=mode))
