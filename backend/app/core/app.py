from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.routes import auth, captures, groups, health, reminders, tasks
from app.core.settings import get_settings
from app.db.migrations import check_required_revision


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    if settings.run_startup_checks:
        check_required_revision(settings.database_url, settings.required_alembic_revision)
    yield


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="Gust API",
        version="0.1.0",
        docs_url="/docs" if settings.app_env != "production" else None,
        redoc_url=None,
        lifespan=lifespan,
    )

    app.state.settings = settings

    app.include_router(health.router)
    app.include_router(auth.router, prefix="/auth/session", tags=["auth-session"])
    app.include_router(captures.router, prefix="/captures", tags=["captures"])
    app.include_router(tasks.router, prefix="/tasks", tags=["tasks"])
    app.include_router(groups.router, prefix="/groups", tags=["groups"])
    app.include_router(
        reminders.router,
        prefix="/internal/reminders",
        tags=["internal-reminders"],
    )

    return app
