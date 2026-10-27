"""Keep blocking work off the event loop.

The API runs in one process with one event loop. A blocking call made directly from async
code (a database query, a synchronous HTTP request) stalls every other request until it
returns, so requests that arrive together end up served one after another.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from functools import wraps

from starlette.concurrency import run_in_threadpool


async def run_blocking[**P, R](func: Callable[P, R], /, *args: P.args, **kwargs: P.kwargs) -> R:
    """Run blocking work in the worker threadpool that FastAPI uses for sync endpoints."""
    return await run_in_threadpool(func, *args, **kwargs)


def blocking[**P, R](func: Callable[P, R]) -> Callable[P, Awaitable[R]]:
    """Expose a blocking function as a coroutine that runs in the worker threadpool."""

    @wraps(func)
    async def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        return await run_blocking(func, *args, **kwargs)

    return wrapper
