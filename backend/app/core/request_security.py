from __future__ import annotations

from urllib.parse import urlparse

from starlette.requests import Request
from starlette.responses import Response

from app.core.settings import Settings

LOCAL_HOSTS: tuple[str, ...] = ("localhost", "127.0.0.1", "[::1]", "testserver")
LOCAL_ORIGINS: tuple[str, ...] = (
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://[::1]:8000",
    "http://testserver",
)


def client_ip_for_request(request: Request) -> str:
    if request.client is not None and request.client.host:
        return request.client.host
    return "unknown"


def allowed_request_origins(settings: Settings) -> set[str]:
    origins = set(LOCAL_ORIGINS)
    for candidate in (
        settings.frontend_app_url,
        settings.backend_public_url,
        *settings.extra_allowed_origins,
    ):
        normalized = _normalize_origin(candidate)
        if normalized is not None:
            origins.add(normalized)
    return origins


def trusted_hosts(settings: Settings) -> list[str]:
    hosts = set(LOCAL_HOSTS)
    has_railway_runtime = any(
        (
            settings.railway_private_domain,
            settings.railway_public_domain,
            settings.railway_service_backend_url,
            settings.railway_service_frontend_url,
            settings.railway_static_url,
        )
    )
    for candidate in settings.trusted_hosts:
        normalized = _hostname_or_host(candidate)
        if normalized is not None:
            hosts.add(normalized)
    for candidate in (
        settings.frontend_app_url,
        settings.backend_public_url,
        settings.railway_private_domain,
        settings.railway_public_domain,
        settings.railway_service_backend_url,
        settings.railway_service_frontend_url,
        settings.railway_static_url,
    ):
        normalized = _hostname_or_host(candidate)
        if normalized is not None:
            hosts.add(normalized)
    if has_railway_runtime:
        hosts.add("*")
    return sorted(hosts)


def validate_browser_origin(request: Request, settings: Settings) -> bool:
    if not settings.enforce_origin_checks:
        return True

    allowed_origins = allowed_request_origins(settings)
    origin = _normalize_origin(request.headers.get("Origin"))
    if origin is not None:
        return origin in allowed_origins

    referer = request.headers.get("Referer")
    referer_origin = _normalize_origin(referer)
    if referer_origin is not None:
        return referer_origin in allowed_origins

    return False


def set_response_security_headers(request: Request, response: Response) -> None:
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=(), interest-cohort=()",
    )

    content_type = response.headers.get("content-type", "")
    has_auth_cookie = bool(
        request.cookies.get("gust_access_token") or request.cookies.get("gust_refresh_token")
    )
    if request.url.path.startswith("/auth/session") or (
        has_auth_cookie and "application/json" in content_type
    ):
        response.headers.setdefault("Cache-Control", "no-store")
        response.headers.setdefault("Pragma", "no-cache")


def _normalize_origin(value: str | None) -> str | None:
    if value is None:
        return None
    parsed = urlparse(value)
    if not parsed.scheme or not parsed.netloc:
        return None
    return f"{parsed.scheme}://{parsed.netloc}"


def _hostname_from_url(value: str | None) -> str | None:
    if value is None:
        return None
    parsed = urlparse(value)
    return parsed.hostname


def _hostname_or_host(value: str | None) -> str | None:
    if value is None:
        return None
    if "://" in value:
        return _hostname_from_url(value)
    candidate = value.strip()
    return candidate or None
