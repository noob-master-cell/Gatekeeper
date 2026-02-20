"""Authentication middleware — enforces JWT auth + Redis sessions + RBAC.

Flow:
1. Skip auth for public routes
2. Extract JWT from cookie or Bearer header
3. Verify JWT signature and expiration
4. Check Redis session (revocation check)
5. Check RBAC permissions for the route
6. Attach current_user to request state
"""

from __future__ import annotations

import jwt as pyjwt
import structlog
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.auth.rbac import check_route_access
from app.auth.sessions import get_session
from app.auth.tokens import verify_access_token
from app.config import settings

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
    """Middleware that verifies JWT tokens, checks Redis sessions, and enforces RBAC.

    - Skips authentication for public routes (login, health, JWKS, etc.)
    - Reads JWT from `gatekeeper_token` cookie or `Authorization: Bearer` header
    - Checks Redis for session validity (revocation support)
    - Checks RBAC policies for route access
    - On failure: returns 401/403 with login redirect info for browser flows
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

        # Verify the JWT
        try:
            claims = verify_access_token(token)
        except pyjwt.ExpiredSignatureError:
            logger.warning("auth.token_expired", path=path)
            return self._unauthorized_response(request, message="Token expired")
        except pyjwt.InvalidTokenError as exc:
            logger.warning("auth.token_invalid", path=path, error=str(exc))
            return self._unauthorized_response(request, message="Invalid token")

        # Check Redis session (if Redis is available)
        if settings.redis_url:
            try:
                session = await get_session(claims.jti)
                if session is None:
                    logger.warning("auth.session_revoked", jti=claims.jti, path=path)
                    return self._unauthorized_response(request, message="Session revoked")

                # Use roles from Redis (may be updated after token issuance)
                claims.roles = session.get("roles", claims.roles)
            except RuntimeError:
                # Redis not initialized (test/dev mode) — skip session check
                logger.debug("auth.redis_not_initialized", path=path)
            except Exception as exc:
                # Redis down — fail closed (strict mode)
                logger.error("auth.redis_error", error=str(exc), path=path)
                return JSONResponse(
                    status_code=503,
                    content={
                        "error": "Session service unavailable",
                        "detail": "Redis is down. Cannot verify session.",
                    },
                )

        # Check RBAC permissions
        allowed, reason = check_route_access(path, claims.roles)
        if not allowed:
            logger.warning(
                "rbac.forbidden",
                path=path,
                user_roles=claims.roles,
                reason=reason,
            )
            return self._forbidden_response(request, reason=reason)

        # Attach user context to request
        request.state.current_user = claims

        logger.info(
            "auth.verified",
            user_id=claims.sub,
            email=claims.email,
            roles=claims.roles,
            path=path,
        )

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

    def _forbidden_response(
        self, request: Request, reason: str = "Insufficient permissions"
    ) -> Response:
        """Return 403 Forbidden."""
        return JSONResponse(
            status_code=403,
            content={
                "error": "Forbidden",
                "detail": reason,
            },
        )
