from fastapi import HTTPException, status


def not_implemented(resource: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail=f"{resource} is scaffolded but not implemented yet.",
    )
