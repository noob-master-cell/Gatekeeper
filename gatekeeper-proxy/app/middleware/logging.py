"""Request logging middleware — structured JSON logging + audit trail."""

from __future__ import annotations

import contextlib
import time
from datetime import UTC, datetime

import structlog
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app.audit import emit_audit_event

logger = structlog.get_logger()


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Middleware that logs every request with structured metadata and emits audit events."""

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

        # Emit audit event for authenticated requests, ignoring dashboard polling
        current_user = getattr(request.state, "current_user", None)
        is_dashboard_poll = request.headers.get("x-dashboard-poll") == "true"
        
        if current_user and not is_dashboard_poll:
            with contextlib.suppress(Exception):
                await emit_audit_event(
                    action="request",
                    user_id=current_user.sub,
                    email=current_user.email,
                    roles=current_user.roles,
                    method=request.method,
                    path=request.url.path,
                    status_code=response.status_code,
                    client_ip=client_host,
                    correlation_id=correlation_id,
                    duration_ms=duration_ms,
                )

        return response
