"""Correlation ID middleware — generates or propagates a unique ID per request."""

from __future__ import annotations

import uuid

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

CORRELATION_ID_HEADER = "X-Correlation-ID"


class CorrelationIdMiddleware(BaseHTTPMiddleware):
    """Middleware that ensures every request has a correlation ID.

    If the incoming request already has an X-Correlation-ID header, it is
    preserved. Otherwise, a new UUID is generated and injected.
    """

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        # Read or generate correlation ID
        correlation_id = request.headers.get(CORRELATION_ID_HEADER)
        if not correlation_id:
            correlation_id = str(uuid.uuid4())

        # Inject into request scope so downstream code can read it
        request.state.correlation_id = correlation_id

        # We need to mutate the headers — create a mutable copy
        # FastAPI/Starlette doesn't let us mutate headers directly,
        # so we set it on request.state and also include it when forwarding.
        response = await call_next(request)

        # Ensure correlation ID is in the response
        response.headers[CORRELATION_ID_HEADER] = correlation_id

        return response
