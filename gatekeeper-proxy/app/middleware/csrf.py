"""CSRF protection middleware — validates Origin header on state-changing requests.

For JWT-based APIs served via cookies, the most effective CSRF protection
is to verify that the Origin or Referer header matches the expected domain.
This blocks cross-origin POST/PUT/DELETE/PATCH requests.
"""

from __future__ import annotations

from urllib.parse import urlparse

import structlog
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

logger = structlog.get_logger()

# HTTP methods that can cause state changes
UNSAFE_METHODS = frozenset({"POST", "PUT", "DELETE", "PATCH"})

# Paths exempt from CSRF checks (e.g. OAuth callbacks, which come from Google)
CSRF_EXEMPT_PATHS = frozenset({"/oauth/callback"})

from app.config import settings

# Allowed origins (extend via config in production)
ALLOWED_ORIGINS = set(settings.parsed_cors_origins)


class CSRFMiddleware(BaseHTTPMiddleware):
    """Validates Origin/Referer headers on unsafe HTTP methods.

    - GET/HEAD/OPTIONS are always allowed (safe methods)
    - POST/PUT/DELETE/PATCH must include a valid Origin or Referer header
    - Requests without an origin (e.g. from curl) are allowed if they
      don't have a cookie (i.e. they use Authorization header directly)
    """

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        # Safe methods — always allowed
        if request.method not in UNSAFE_METHODS:
            return await call_next(request)

        # Exempt paths
        if request.url.path in CSRF_EXEMPT_PATHS:
            return await call_next(request)

        # If no cookie was sent, the request isn't using cookie-based auth,
        # so CSRF is not a concern (likely using Authorization header)
        if "cookie" not in request.headers:
            return await call_next(request)

        # Validate Origin header
        origin = request.headers.get("origin")
        if not origin:
            # Fall back to Referer
            referer = request.headers.get("referer")
            if referer:
                parsed = urlparse(referer)
                origin = f"{parsed.scheme}://{parsed.netloc}"

        if not origin:
            logger.warning(
                "csrf.missing_origin",
                path=request.url.path,
                method=request.method,
            )
            return JSONResponse(
                status_code=403,
                content={"error": "CSRF validation failed: missing Origin header"},
            )

        if origin not in ALLOWED_ORIGINS:
            logger.warning(
                "csrf.invalid_origin",
                origin=origin,
                path=request.url.path,
                method=request.method,
            )
            return JSONResponse(
                status_code=403,
                content={"error": "CSRF validation failed: invalid Origin"},
            )

        return await call_next(request)
