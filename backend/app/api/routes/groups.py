from fastapi import APIRouter

from app.core.errors import not_implemented

router = APIRouter()


@router.get("")
def list_groups() -> None:
    raise not_implemented("Group listing")
