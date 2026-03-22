from fastapi import APIRouter

from app.core.errors import not_implemented

router = APIRouter()


@router.get("")
def get_session_status() -> None:
    raise not_implemented("Auth session endpoint")
