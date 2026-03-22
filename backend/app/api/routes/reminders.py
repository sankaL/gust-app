from fastapi import APIRouter

from app.core.errors import not_implemented

router = APIRouter()


@router.post("/run")
def run_due_reminders() -> None:
    raise not_implemented("Reminder worker")
