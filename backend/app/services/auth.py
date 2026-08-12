from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlencode, urlparse, urlunparse

import httpx
import jwt
from jwt import ExpiredSignatureError, InvalidTokenError, PyJWKClient

from app.core.errors import (
    AUTH_EMAIL_NOT_ALLOWED_MESSAGE,
    AuthEmailNotAllowedError,
    ConfigurationError,
    UpstreamAuthError,
)
from app.core.security import TokenBundle
from app.core.settings import Settings


@dataclass
class AuthenticatedIdentity:
    user_id: str
    email: str
    display_name: str | None


@dataclass
class AuthenticatedSession:
    tokens: TokenBundle
    identity: AuthenticatedIdentity


class SupabaseAuthService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._jwks_client: PyJWKClient | None = None

    def ensure_configured(self) -> None:
        if not self.settings.supabase_url or not self.settings.supabase_anon_key:
            raise ConfigurationError("Supabase auth configuration is missing.")
        if not self.settings.backend_public_url or not self.settings.frontend_app_url:
            raise ConfigurationError("Backend and frontend auth URLs must be configured.")

    @property
    def authorize_url(self) -> str:
        assert self.settings.supabase_url is not None
        return f"{self.settings.supabase_url.rstrip('/')}/auth/v1/authorize"

    @property
    def token_url(self) -> str:
        assert self.settings.supabase_url is not None
        return f"{self.settings.supabase_url.rstrip('/')}/auth/v1/token"

    @property
    def signup_url(self) -> str:
        assert self.settings.supabase_url is not None
        return f"{self.settings.supabase_url.rstrip('/')}/auth/v1/signup"

    @property
    def logout_url(self) -> str:
        assert self.settings.supabase_url is not None
        return f"{self.settings.supabase_url.rstrip('/')}/auth/v1/logout"

    @property
    def jwks_url(self) -> str:
        assert self.settings.supabase_url is not None
        return f"{self.settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"

    @property
    def issuer(self) -> str:
        assert self.settings.supabase_url is not None
        return f"{self.settings.supabase_url.rstrip('/')}/auth/v1"

    def accepted_issuers(self) -> set[str]:
        issuers = {self.issuer}

        if not self.settings.gust_dev_mode:
            return issuers

        parsed_issuer = urlparse(self.issuer)
        if parsed_issuer.hostname != "host.docker.internal":
            return issuers

        for hostname in ("127.0.0.1", "localhost"):
            issuers.add(
                urlunparse(parsed_issuer._replace(netloc=f"{hostname}:{parsed_issuer.port}"))
            )

        return issuers

    @property
    def callback_url(self) -> str:
        assert self.settings.backend_public_url is not None
        return f"{self.settings.backend_public_url.rstrip('/')}/auth/session/callback"

    def build_google_authorize_url(
        self,
        *,
        code_challenge: str,
    ) -> str:
        self.ensure_configured()
        query = urlencode(
            {
                "provider": "google",
                "redirect_to": self.callback_url,
                "code_challenge": code_challenge,
                "code_challenge_method": "S256",
            }
        )
        return f"{self.authorize_url}?{query}"

    async def exchange_code_for_session(
        self,
        *,
        code: str,
        code_verifier: str,
    ) -> AuthenticatedSession:
        payload = {"auth_code": code, "code_verifier": code_verifier}
        data = await self._post_token_request({"grant_type": "pkce"}, payload)
        return self._parse_session(data)

    async def refresh_session(self, *, refresh_token: str) -> AuthenticatedSession:
        payload = {"refresh_token": refresh_token}
        data = await self._post_token_request({"grant_type": "refresh_token"}, payload)
        return self._parse_session(data)

    async def sign_up_with_password(
        self,
        *,
        email: str,
        password: str,
        display_name: str | None = None,
    ) -> AuthenticatedSession:
        payload: dict[str, Any] = {
            "email": email,
            "password": password,
        }
        if display_name:
            payload["data"] = {
                "full_name": display_name,
                "name": display_name,
            }
        data = await self._post_auth_request(self.signup_url, payload)
        return self._parse_session(data)

    async def sign_in_with_password(
        self,
        *,
        email: str,
        password: str,
    ) -> AuthenticatedSession:
        payload = {
            "email": email,
            "password": password,
        }
        data = await self._post_auth_request(
            self.token_url,
            payload,
            query_params={"grant_type": "password"},
        )
        return self._parse_session(data)

    async def revoke_refresh_token(self, *, refresh_token: str) -> None:
        self.ensure_configured()
        headers = {"apikey": self.settings.supabase_anon_key or ""}
        params = {"scope": "global"}
        payload = {"refresh_token": refresh_token}

        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                self.logout_url,
                params=params,
                json=payload,
                headers=headers,
            )
        if response.status_code >= 400:
            raise UpstreamAuthError("Authentication provider logout failed.")

    def validate_access_token(
        self,
        access_token: str,
        *,
        allow_expired: bool = False,
    ) -> AuthenticatedIdentity:
        self.ensure_configured()
        signing_key = self._get_jwks_client().get_signing_key_from_jwt(access_token).key
        # NOTE: Supabase JWTs do not include an audience claim ("aud"), so we cannot
        # verify it. Supabase uses the JWT for session management within their ecosystem
        # and the audience is implicitly the Supabase project. We rely on issuer
        # validation and the fact that the token was obtained through our OAuth/code
        # exchange flow. See: https://github.com/orgs/supabase/discussions/17932
        claims = jwt.decode(
            access_token,
            signing_key,
            algorithms=["ES256", "RS256"],
            options={
                "require": ["exp", "iat", "sub"],
                "verify_aud": False,
                "verify_exp": not allow_expired,
                "verify_iss": False,
            },
        )

        issuer = claims.get("iss")
        if issuer not in self.accepted_issuers():
            raise InvalidTokenError("JWT issuer did not match the configured Supabase auth issuer.")

        email = claims.get("email")
        user_id = claims.get("sub")
        if not user_id or not email:
            raise InvalidTokenError("JWT is missing required identity claims.")

        metadata = claims.get("user_metadata") or {}
        return AuthenticatedIdentity(
            user_id=str(user_id),
            email=str(email),
            display_name=metadata.get("full_name") or metadata.get("name"),
        )

    def _get_jwks_client(self) -> PyJWKClient:
        if self._jwks_client is None:
            self._jwks_client = PyJWKClient(self.jwks_url, timeout=10.0)
        return self._jwks_client

    async def _post_token_request(
        self,
        query_params: dict[str, str],
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        return await self._post_auth_request(
            self.token_url,
            payload,
            query_params=query_params,
        )

    async def _post_auth_request(
        self,
        url: str,
        payload: dict[str, Any],
        *,
        query_params: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        self.ensure_configured()
        headers = {"apikey": self.settings.supabase_anon_key or ""}
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                url,
                params=query_params,
                json=payload,
                headers=headers,
            )
        if response.status_code >= 400:
            error_message = self._extract_error_message(response)
            if self._is_email_not_allowed_error(response.status_code, error_message):
                raise AuthEmailNotAllowedError()
            raise UpstreamAuthError("Authentication provider token exchange failed.")
        return response.json()

    def _parse_session(self, payload: dict[str, Any]) -> AuthenticatedSession:
        access_token = payload.get("access_token")
        refresh_token = payload.get("refresh_token")
        expires_in = payload.get("expires_in") or 3600
        user = payload.get("user") or {}
        user_id = user.get("id")
        email = user.get("email")
        if not access_token or not refresh_token or not user_id or not email:
            raise UpstreamAuthError("Authentication provider returned an incomplete session.")
        metadata = user.get("user_metadata") or {}
        return AuthenticatedSession(
            tokens=TokenBundle(
                access_token=str(access_token),
                refresh_token=str(refresh_token),
                expires_in=int(expires_in),
            ),
            identity=AuthenticatedIdentity(
                user_id=str(user_id),
                email=str(email),
                display_name=metadata.get("full_name") or metadata.get("name"),
            ),
        )

    @staticmethod
    def _extract_error_message(response: httpx.Response) -> str | None:
        try:
            payload = response.json()
        except ValueError:
            return None

        if isinstance(payload, dict):
            for key in ("msg", "message", "error_description", "error"):
                value = payload.get(key)
                if isinstance(value, str):
                    return value

        return None

    @staticmethod
    def _is_email_not_allowed_error(status_code: int, error_message: str | None) -> bool:
        if status_code != 403 or not error_message:
            return False

        return AUTH_EMAIL_NOT_ALLOWED_MESSAGE.lower() in error_message.strip().lower()


class LocalDevAuthService:
    """Issue signed local-only sessions without an external identity provider."""

    ISSUER = "gust-local-dev"
    USER_ID = str(uuid.uuid5(uuid.NAMESPACE_URL, "gust:local-dev:user"))
    EMAIL = "local-dev@gust.local"
    DISPLAY_NAME = "Local Dev User"
    ACCESS_TOKEN_TTL = timedelta(hours=1)
    REFRESH_TOKEN_TTL = timedelta(days=30)

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def ensure_configured(self) -> None:
        if not self.settings.gust_dev_mode:
            raise ConfigurationError("Local development auth is disabled.")
        if not self.settings.local_dev_auth_secret:
            raise ConfigurationError("Local development auth secret is missing.")
        if len(self.settings.local_dev_auth_secret) < 32:
            raise ConfigurationError(
                "Local development auth secret must contain at least 32 characters."
            )

    def create_dev_session(self) -> AuthenticatedSession:
        self.ensure_configured()
        identity = AuthenticatedIdentity(
            user_id=self.USER_ID,
            email=self.EMAIL,
            display_name=self.DISPLAY_NAME,
        )
        return AuthenticatedSession(tokens=self._issue_tokens(identity), identity=identity)

    async def refresh_session(self, *, refresh_token: str) -> AuthenticatedSession:
        identity = self._validate_token(refresh_token, token_type="refresh")
        return AuthenticatedSession(tokens=self._issue_tokens(identity), identity=identity)

    async def revoke_refresh_token(self, *, refresh_token: str) -> None:
        self._validate_token(refresh_token, token_type="refresh")

    def validate_access_token(
        self,
        access_token: str,
        *,
        allow_expired: bool = False,
    ) -> AuthenticatedIdentity:
        return self._validate_token(
            access_token,
            token_type="access",
            allow_expired=allow_expired,
        )

    def _issue_tokens(self, identity: AuthenticatedIdentity) -> TokenBundle:
        now = datetime.now(UTC)
        return TokenBundle(
            access_token=self._encode_token(
                identity,
                token_type="access",
                issued_at=now,
                expires_at=now + self.ACCESS_TOKEN_TTL,
            ),
            refresh_token=self._encode_token(
                identity,
                token_type="refresh",
                issued_at=now,
                expires_at=now + self.REFRESH_TOKEN_TTL,
            ),
            expires_in=int(self.ACCESS_TOKEN_TTL.total_seconds()),
        )

    def _encode_token(
        self,
        identity: AuthenticatedIdentity,
        *,
        token_type: str,
        issued_at: datetime,
        expires_at: datetime,
    ) -> str:
        self.ensure_configured()
        return jwt.encode(
            {
                "iss": self.ISSUER,
                "sub": identity.user_id,
                "email": identity.email,
                "display_name": identity.display_name,
                "token_type": token_type,
                "iat": issued_at,
                "exp": expires_at,
                "jti": str(uuid.uuid4()),
            },
            self.settings.local_dev_auth_secret,
            algorithm="HS256",
        )

    def _validate_token(
        self,
        token: str,
        *,
        token_type: str,
        allow_expired: bool = False,
    ) -> AuthenticatedIdentity:
        self.ensure_configured()
        claims = jwt.decode(
            token,
            self.settings.local_dev_auth_secret,
            algorithms=["HS256"],
            issuer=self.ISSUER,
            options={
                "require": ["exp", "iat", "iss", "sub", "email", "token_type"],
                "verify_exp": not allow_expired,
            },
        )
        if claims.get("token_type") != token_type:
            raise InvalidTokenError("Local development token type did not match.")
        if claims.get("sub") != self.USER_ID or claims.get("email") != self.EMAIL:
            raise InvalidTokenError("Local development token identity did not match.")
        return AuthenticatedIdentity(
            user_id=self.USER_ID,
            email=self.EMAIL,
            display_name=self.DISPLAY_NAME,
        )


AuthService = SupabaseAuthService | LocalDevAuthService


def build_auth_service(settings: Settings) -> AuthService:
    if settings.gust_dev_mode:
        return LocalDevAuthService(settings)
    return SupabaseAuthService(settings)


__all__ = [
    "AuthenticatedIdentity",
    "AuthenticatedSession",
    "AuthService",
    "ExpiredSignatureError",
    "InvalidTokenError",
    "LocalDevAuthService",
    "SupabaseAuthService",
    "build_auth_service",
]
