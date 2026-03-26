from __future__ import annotations

# ruff: noqa: UP045
from dataclasses import dataclass
from typing import Any, Optional
from urllib.parse import urlencode, urlparse, urlunparse

import httpx
import jwt
from jwt import ExpiredSignatureError, InvalidTokenError, PyJWKClient

from app.core.errors import ConfigurationError, UpstreamAuthError
from app.core.security import TokenBundle
from app.core.settings import Settings


@dataclass
class AuthenticatedIdentity:
    user_id: str
    email: str
    display_name: Optional[str]


@dataclass
class AuthenticatedSession:
    tokens: TokenBundle
    identity: AuthenticatedIdentity


class SupabaseAuthService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._jwks_client: Optional[PyJWKClient] = None

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
        state: str,
        code_challenge: str,
    ) -> str:
        self.ensure_configured()
        query = urlencode(
            {
                "provider": "google",
                "redirect_to": self.callback_url,
                "code_challenge": code_challenge,
                "code_challenge_method": "S256",
                "state": state,
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
        display_name: Optional[str] = None,
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

    def validate_access_token(self, access_token: str) -> AuthenticatedIdentity:
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
            options={"require": ["exp", "iat", "sub"], "verify_aud": False, "verify_iss": False},
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
        query_params: Optional[dict[str, str]] = None,
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


__all__ = [
    "AuthenticatedIdentity",
    "AuthenticatedSession",
    "ExpiredSignatureError",
    "InvalidTokenError",
    "SupabaseAuthService",
]
