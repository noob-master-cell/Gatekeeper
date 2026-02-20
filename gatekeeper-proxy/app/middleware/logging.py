"""Request logging middleware — structured JSON logging for every request."""

from __future__ import annotations

import time

import structlog
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

logger = structlog.get_logger()


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Middleware that logs every request with structured metadata."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        start_time = time.monotonic()

        correlation_id = getattr(request.state, "correlation_id", "unknown")
        client_host = request.client.host if request.client else "unknown"

        log = logger.bind(
            correlation_id=correlation_id,
            method=request.method,
            path=request.url.path,
            client_ip=client_host,
        )

        log.info("request.start")

        response = await call_next(request)

        duration_ms = round((time.monotonic() - start_time) * 1000, 2)

        log.info(
            "request.complete",
            status_code=response.status_code,
            duration_ms=duration_ms,
        )

        return response
