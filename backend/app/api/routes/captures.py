from fastapi import APIRouter

from app.core.errors import not_implemented

router = APIRouter()


@router.post("")
def create_capture() -> None:
    raise not_implemented("Capture creation")
