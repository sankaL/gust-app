from fastapi import APIRouter

router = APIRouter()


@router.api_route("/health", methods=["GET", "HEAD"])
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}
