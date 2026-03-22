from fastapi import APIRouter

from app.core.errors import not_implemented

router = APIRouter()


@router.get("")
def list_tasks() -> None:
    raise not_implemented("Task listing")
