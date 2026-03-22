from app.core.settings import Settings
from app.services.auth import SupabaseAuthService


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
