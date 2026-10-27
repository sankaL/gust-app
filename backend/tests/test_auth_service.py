import asyncio

import httpx
import pytest

from app.core.errors import ConfigurationError, InvalidCredentialsError, UpstreamAuthError
from app.core.settings import Settings
from app.services.auth import LocalDevAuthService, SupabaseAuthService


def test_dev_mode_accepts_local_supabase_issuer_aliases() -> None:
    settings = Settings(
        APP_ENV="development",
        GUST_DEV_MODE=True,
        DATABASE_URL="sqlite+pysqlite:///:memory:",
        FRONTEND_APP_URL="http://localhost:3000",
        BACKEND_PUBLIC_URL="http://localhost:8000",
        SUPABASE_URL="http://host.docker.internal:54321",
        SUPABASE_ANON_KEY="test-anon-key",
    )

    service = SupabaseAuthService(settings)

    assert service.accepted_issuers() == {
        "http://host.docker.internal:54321/auth/v1",
        "http://127.0.0.1:54321/auth/v1",
        "http://localhost:54321/auth/v1",
    }


def test_non_dev_mode_uses_only_configured_issuer() -> None:
    settings = Settings(
        APP_ENV="development",
        GUST_DEV_MODE=False,
        DATABASE_URL="sqlite+pysqlite:///:memory:",
        FRONTEND_APP_URL="http://localhost:3000",
        BACKEND_PUBLIC_URL="http://localhost:8000",
        SUPABASE_URL="http://host.docker.internal:54321",
        SUPABASE_ANON_KEY="test-anon-key",
    )

    service = SupabaseAuthService(settings)

    assert service.accepted_issuers() == {"http://host.docker.internal:54321/auth/v1"}


def test_local_dev_auth_defense_in_depth_rejects_production() -> None:
    settings = Settings(
        APP_ENV="development",
        GUST_DEV_MODE=True,
        DATABASE_URL="sqlite+pysqlite:///:memory:",
        LOCAL_DEV_AUTH_SECRET="test-local-dev-secret-that-is-at-least-32-characters",
    )
    settings.app_env = "production"

    with pytest.raises(ConfigurationError, match="unavailable in production"):
        LocalDevAuthService(settings).ensure_configured()


def _supabase_service_with_transport(
    monkeypatch: pytest.MonkeyPatch,
    handler,
) -> SupabaseAuthService:
    real_async_client = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda timeout: real_async_client(transport=httpx.MockTransport(handler), timeout=timeout),
    )
    settings = Settings(
        APP_ENV="development",
        GUST_DEV_MODE=False,
        DATABASE_URL="sqlite+pysqlite:///:memory:",
        SUPABASE_URL="https://project.supabase.test",
        SUPABASE_ANON_KEY="test-anon-key",
    )
    return SupabaseAuthService(settings)


def test_password_sign_in_uses_supabase_password_grant(monkeypatch: pytest.MonkeyPatch) -> None:
    seen_requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_requests.append(request)
        return httpx.Response(
            200,
            json={
                "access_token": "access-token",
                "refresh_token": "refresh-token",
                "expires_in": 3600,
                "user": {
                    "id": "11111111-1111-1111-1111-111111111111",
                    "email": "user@example.com",
                    "user_metadata": {"full_name": "Gust User"},
                },
            },
        )

    service = _supabase_service_with_transport(monkeypatch, handler)

    session = asyncio.run(
        service.sign_in_with_password(email="user@example.com", password="secret-password")
    )

    assert session.identity.email == "user@example.com"
    assert session.identity.display_name == "Gust User"
    assert session.tokens.refresh_token == "refresh-token"
    request = seen_requests[0]
    assert str(request.url) == "https://project.supabase.test/auth/v1/token?grant_type=password"
    assert request.headers["apikey"] == "test-anon-key"


def test_password_sign_in_maps_supabase_400_to_generic_invalid_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _supabase_service_with_transport(
        monkeypatch,
        lambda request: httpx.Response(
            400,
            json={"error_code": "invalid_credentials", "msg": "Invalid login credentials"},
        ),
    )

    with pytest.raises(InvalidCredentialsError):
        asyncio.run(service.sign_in_with_password(email="user@example.com", password="wrong"))


def test_password_sign_in_surfaces_provider_outage_as_upstream_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _supabase_service_with_transport(
        monkeypatch,
        lambda request: httpx.Response(503, json={"msg": "unavailable"}),
    )

    with pytest.raises(UpstreamAuthError):
        asyncio.run(service.sign_in_with_password(email="user@example.com", password="secret"))


def test_refresh_rejection_is_not_reported_as_invalid_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _supabase_service_with_transport(
        monkeypatch,
        lambda request: httpx.Response(400, json={"error_code": "refresh_token_not_found"}),
    )

    with pytest.raises(UpstreamAuthError):
        asyncio.run(service.refresh_session(refresh_token="stale-refresh-token"))


def test_supabase_auth_calls_reuse_the_shared_http_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen_paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_paths.append(request.url.path)
        return httpx.Response(
            200,
            json={
                "access_token": "access-token",
                "refresh_token": "refresh-token",
                "expires_in": 3600,
                "user": {"id": "11111111-1111-1111-1111-111111111111", "email": "user@example.com"},
            },
        )

    shared_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    def no_per_call_client(**kwargs: object) -> httpx.AsyncClient:
        raise AssertionError("auth calls should use the shared client")

    monkeypatch.setattr(httpx, "AsyncClient", no_per_call_client)
    settings = Settings(
        APP_ENV="development",
        GUST_DEV_MODE=False,
        DATABASE_URL="sqlite+pysqlite:///:memory:",
        SUPABASE_URL="https://project.supabase.test",
        SUPABASE_ANON_KEY="test-anon-key",
    )
    service = SupabaseAuthService(settings, http_client=shared_client)

    async def refresh_twice_then_close() -> None:
        await service.refresh_session(refresh_token="first-refresh-token")
        await service.refresh_session(refresh_token="second-refresh-token")
        await shared_client.aclose()

    asyncio.run(refresh_twice_then_close())

    assert seen_paths == ["/auth/v1/token", "/auth/v1/token"]
