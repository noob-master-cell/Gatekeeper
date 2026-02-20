"""JWT token service — issue and verify RS256 tokens."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
import structlog

from app.auth.keys import get_kid, get_private_key, get_public_key_pem
from app.config import settings

logger = structlog.get_logger()


# ─── Token models ─────────────────────────────────────────────


class TokenClaims:
    """Parsed JWT token claims."""

    def __init__(self, claims: dict[str, Any]) -> None:
        self.sub: str = claims.get("sub", "")
        self.email: str = claims.get("email", "")
        self.roles: list[str] = claims.get("roles", [])
        self.jti: str = claims.get("jti", "")
        self.exp: datetime | None = None
        if "exp" in claims:
            self.exp = datetime.fromtimestamp(claims["exp"], tz=UTC)
        self.iat: datetime | None = None
        if "iat" in claims:
            self.iat = datetime.fromtimestamp(claims["iat"], tz=UTC)

    def to_dict(self) -> dict[str, Any]:
        return {
            "sub": self.sub,
            "email": self.email,
            "roles": self.roles,
            "jti": self.jti,
        }


# ─── Token issuance ──────────────────────────────────────────


def create_access_token(
    user_id: str,
    email: str,
    roles: list[str] | None = None,
    expires_delta: timedelta | None = None,
) -> str:
    """Create a signed JWT access token.

    Args:
        user_id: The user's unique identifier (sub claim).
        email: The user's email address.
        roles: List of role names. Defaults to ["user"].
        expires_delta: Custom expiry. Defaults to settings.jwt_expiry_minutes.

    Returns:
        Encoded JWT string.
    """
    now = datetime.now(UTC)
    expires = now + (expires_delta or timedelta(minutes=settings.jwt_expiry_minutes))
    jti = str(uuid.uuid4())

    payload = {
        "sub": user_id,
        "email": email,
        "roles": roles or ["user"],
        "jti": jti,
        "iat": now,
        "exp": expires,
        "iss": "gatekeeper-proxy",
    }

    private_key = get_private_key()
    token = jwt.encode(
        payload,
        private_key,
        algorithm="RS256",
        headers={"kid": get_kid()},
    )

    logger.info(
        "auth.token.created",
        user_id=user_id,
        email=email,
        jti=jti,
        expires=expires.isoformat(),
    )
    return token


# ─── Token verification ──────────────────────────────────────


def verify_access_token(token: str) -> TokenClaims:
    """Verify and decode a JWT access token.

    Args:
        token: The encoded JWT string.

    Returns:
        TokenClaims with parsed claims.

    Raises:
        jwt.ExpiredSignatureError: If the token has expired.
        jwt.InvalidTokenError: If the token is otherwise invalid.
    """
    public_key_pem = get_public_key_pem()

    payload = jwt.decode(
        token,
        public_key_pem,
        algorithms=["RS256"],
        issuer="gatekeeper-proxy",
    )

    return TokenClaims(payload)


def decode_token_unverified(token: str) -> dict[str, Any]:
    """Decode a token WITHOUT verifying the signature (for debugging only)."""
    return jwt.decode(token, options={"verify_signature": False})
