"""API key authentication middleware for the control plane.

Protects all /admin/* endpoints with a shared API key.
The proxy sends this key in the X-API-Key header.
Health and public endpoints are exempt.
"""

from __future__ import annotations

import hmac

import structlog
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.config import settings

logger = structlog.get_logger()

# Endpoints that do NOT require an API key
PUBLIC_PATHS = frozenset({"/health", "/docs", "/openapi.json", "/redoc"})


class APIKeyMiddleware(BaseHTTPMiddleware):
    """Middleware that enforces API key authentication on /admin/* endpoints.

    - Skips authentication for health checks and public routes
    - Requires a valid X-API-Key header for all /admin/* endpoints
    - Uses constant-time comparison to prevent timing attacks
    - If no API key is configured (dev mode), all requests are allowed
    """

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        path = request.url.path

        # Skip auth for public/health endpoints
        if path in PUBLIC_PATHS:
            return await call_next(request)

        # If no API key is configured, skip auth (dev mode)
        if not settings.api_key:
            return await call_next(request)

        # All other endpoints require API key
        provided_key = request.headers.get("X-API-Key", "")

        if not provided_key or not hmac.compare_digest(provided_key, settings.api_key):
            logger.warning(
                "api_key.rejected",
                path=path,
                client_ip=request.client.host if request.client else "unknown",
            )
            return JSONResponse(
                status_code=401,
                content={"error": "Invalid or missing API key"},
            )

        return await call_next(request)
