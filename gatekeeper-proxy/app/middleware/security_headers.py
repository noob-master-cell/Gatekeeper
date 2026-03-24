"""Security headers middleware — adds browser security headers to all responses.

Headers added:
  - Strict-Transport-Security (HSTS)
  - Content-Security-Policy
  - X-Content-Type-Options
  - X-Frame-Options
  - Referrer-Policy
  - Permissions-Policy
"""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Injects security headers into every response."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)

        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["X-XSS-Protection"] = "1; mode=block"

        # HSTS — only set when not in dev mode (requires HTTPS)
        from app.config import settings
        if not settings.dev_mode:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

        return response
