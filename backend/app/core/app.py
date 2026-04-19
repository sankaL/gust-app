from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api.routes import auth, captures, groups, health, reminders, tasks
from app.core.errors import (
    ApiError,
    api_error_handler,
    http_exception_handler,
    migration_exception_handler,
    unexpected_exception_handler,
    validation_exception_handler,
)
from app.core.logging import configure_logging
from app.core.middleware import RequestContextMiddleware
from app.core.request_security import trusted_hosts
from app.core.settings import get_settings
from app.db.engine import dispose_all_engines
from app.db.migrations import MigrationVersionError, check_required_revision


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    if settings.run_startup_checks:
        check_required_revision(settings.database_url, settings.required_alembic_revision)
    yield
    dispose_all_engines()


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title="Gust API",
        version="0.1.0",
        docs_url="/docs" if settings.app_env != "production" else None,
        redoc_url=None,
        lifespan=lifespan,
    )

    app.state.settings = settings
    if settings.frontend_app_url:
        # In dev mode, allow localhost and local network IPs for mobile testing
        if settings.gust_dev_mode:
            # Allow all localhost variations and local network IPs
            cors_kwargs = {
                "allow_origin_regex": r"https?://(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+):\d+",
                "allow_credentials": True,
                "allow_methods": ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
                "allow_headers": ["Content-Type", "X-CSRF-Token"],
            }
        else:
            cors_kwargs = {
                "allow_origins": [settings.frontend_app_url],
                "allow_credentials": True,
                "allow_methods": ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
                "allow_headers": ["Content-Type", "X-CSRF-Token"],
            }
        
        app.add_middleware(
            CORSMiddleware,
            **cors_kwargs,
        )
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=trusted_hosts(settings))
    app.add_middleware(RequestContextMiddleware, settings=settings)
    app.add_exception_handler(ApiError, api_error_handler)
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(MigrationVersionError, migration_exception_handler)
    app.add_exception_handler(Exception, unexpected_exception_handler)

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
