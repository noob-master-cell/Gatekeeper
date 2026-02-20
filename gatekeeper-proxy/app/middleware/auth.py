"""Authentication middleware — enforces JWT auth on protected routes."""

from __future__ import annotations

import jwt as pyjwt
import structlog
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.auth.tokens import verify_access_token

logger = structlog.get_logger()

# Routes that do NOT require authentication
PUBLIC_ROUTES = frozenset(
    {
        "/login",
        "/oauth/callback",
        "/auth/dev-login",
        "/auth/logout",
        "/proxy/health",
        "/health",
        "/.well-known/jwks.json",
    }
)

# Prefixes that do NOT require authentication
PUBLIC_PREFIXES = (
    "/auth/",
    "/static/",
    "/docs",
    "/openapi.json",
    "/redoc",
)


class AuthMiddleware(BaseHTTPMiddleware):
    """Middleware that verifies JWT tokens and attaches current_user to request.

    - Skips authentication for public routes (login, health, JWKS, etc.)
    - Reads JWT from `gatekeeper_token` cookie or `Authorization: Bearer` header
    - On failure: returns 401 with login redirect info for browser flows
    """

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        path = request.url.path

        # Skip auth for public routes
        if path in PUBLIC_ROUTES or any(path.startswith(p) for p in PUBLIC_PREFIXES):
            return await call_next(request)

        # Extract token from cookie or Authorization header
        token = self._extract_token(request)

        if not token:
            correlation_id = getattr(request.state, "correlation_id", "unknown")
            logger.warning(
                "auth.missing_token",
                path=path,
                correlation_id=correlation_id,
            )
            return self._unauthorized_response(request)

        # Verify the token
        try:
            claims = verify_access_token(token)
            request.state.current_user = claims

            logger.info(
                "auth.verified",
                user_id=claims.sub,
                email=claims.email,
                roles=claims.roles,
                path=path,
            )

        except pyjwt.ExpiredSignatureError:
            logger.warning("auth.token_expired", path=path)
            return self._unauthorized_response(request, message="Token expired")

        except pyjwt.InvalidTokenError as exc:
            logger.warning("auth.token_invalid", path=path, error=str(exc))
            return self._unauthorized_response(request, message="Invalid token")

        return await call_next(request)

    def _extract_token(self, request: Request) -> str | None:
        """Extract JWT from cookie or Authorization header."""
        # Try cookie first
        token = request.cookies.get("gatekeeper_token")
        if token:
            return token

        # Try Authorization header
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            return auth_header[7:]

        return None

    def _unauthorized_response(
        self, request: Request, message: str = "Authentication required"
    ) -> Response:
        """Return 401 with appropriate format based on request type."""
        # Check if this is a browser request (Accept: text/html)
        accept = request.headers.get("accept", "")
        if "text/html" in accept:
            from starlette.responses import RedirectResponse

            return RedirectResponse(url="/login", status_code=302)

        return JSONResponse(
            status_code=401,
            content={
                "error": message,
                "login_url": "/login",
            },
        )
