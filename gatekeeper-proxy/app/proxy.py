"""Core proxy forwarding engine using httpx.AsyncClient with connection pooling."""

from __future__ import annotations

from collections.abc import AsyncIterator

import httpx
import structlog
from fastapi import Request
from fastapi.responses import StreamingResponse
from starlette.responses import Response

from app.config import settings
from app.mtls import create_mtls_ssl_context

logger = structlog.get_logger()

# ─── Shared async HTTP client (connection-pooled) ────────────

_client: httpx.AsyncClient | None = None


async def get_client() -> httpx.AsyncClient:
    """Return a shared, connection-pooled httpx AsyncClient."""
    global _client  # noqa: PLW0603
    if _client is None or _client.is_closed:
        # Load mTLS context if enabled
        ssl_context = create_mtls_ssl_context() if settings.mtls_enabled else True
        
        _client = httpx.AsyncClient(
            verify=ssl_context,
            limits=httpx.Limits(
                max_connections=settings.max_connections,
                max_keepalive_connections=settings.max_keepalive_connections,
            ),
            timeout=httpx.Timeout(
                connect=settings.backend_connect_timeout,
                read=settings.backend_read_timeout,
                write=settings.backend_read_timeout,
                pool=settings.backend_connect_timeout,
            ),
            follow_redirects=False,
        )
    return _client


async def close_client() -> None:
    """Gracefully close the shared client."""
    global _client  # noqa: PLW0603
    if _client and not _client.is_closed:
        await _client.aclose()
        _client = None


# ─── Header processing ───────────────────────────────────────

# Headers that should NOT be forwarded to the backend
HOP_BY_HOP_HEADERS = frozenset(
    {
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailers",
        "transfer-encoding",
        "upgrade",
        "host",
    }
)


def build_forwarded_headers(request: Request) -> dict[str, str]:
    """Build headers to send to the backend, stripping hop-by-hop and injecting X-Forwarded-*."""
    headers: dict[str, str] = {}

    for key, value in request.headers.items():
        if key.lower() not in HOP_BY_HOP_HEADERS:
            headers[key] = value

    # Inject standard forwarding headers
    client_host = request.client.host if request.client else "unknown"
    headers["X-Forwarded-For"] = client_host
    headers["X-Forwarded-Proto"] = request.url.scheme
    headers["X-Forwarded-Host"] = request.headers.get("host", "unknown")

    # Set correct Host for the backend
    backend_host = settings.backend_url.replace("http://", "").replace("https://", "")
    headers["host"] = backend_host

    return headers


# ─── Proxy forwarding ────────────────────────────────────────


async def forward_request(request: Request) -> Response:
    """Forward the incoming request to the backend and stream the response back."""
    client = await get_client()

    # Build target URL
    path = request.url.path
    query = str(request.url.query)
    
    # Route all /admin/* requests to control plane
    base_url = settings.backend_url
    if path.startswith("/admin/"):
        base_url = settings.control_plane_url
        
    if settings.mtls_enabled:
        base_url = base_url.replace("http://", "https://")
        
    target_url = f"{base_url}{path}"
    if query:
        target_url = f"{target_url}?{query}"

    # Build headers
    headers = build_forwarded_headers(request)

    # Inject API key for control-plane requests
    if path.startswith("/admin/") and settings.cp_api_key:
        headers["X-API-Key"] = settings.cp_api_key

    correlation_id = headers.get("X-Correlation-ID", "")

    log = logger.bind(
        correlation_id=correlation_id,
        method=request.method,
        target_url=target_url,
    )

    # Read body (for non-GET methods)
    body = await request.body()

    try:
        log.info("proxy.forwarding")
        backend_response = await client.request(
            method=request.method,
            url=target_url,
            headers=headers,
            content=body if body else None,
        )
        log.info("proxy.response", status_code=backend_response.status_code)

    except httpx.ConnectTimeout:
        log.error("proxy.error.connect_timeout")
        return Response(
            content='{"error": "Backend connection timed out", "code": 504}',
            status_code=504,
            media_type="application/json",
        )
    except httpx.ReadTimeout:
        log.error("proxy.error.read_timeout")
        return Response(
            content='{"error": "Backend read timed out", "code": 504}',
            status_code=504,
            media_type="application/json",
        )
    except httpx.ConnectError:
        log.error("proxy.error.connect_error")
        return Response(
            content='{"error": "Could not connect to backend", "code": 502}',
            status_code=502,
            media_type="application/json",
        )
    except httpx.HTTPError as exc:
        log.error("proxy.error.http", error=str(exc))
        return Response(
            content='{"error": "Bad gateway", "code": 502}',
            status_code=502,
            media_type="application/json",
        )

    # Map 5xx to 502
    status_code = backend_response.status_code
    if status_code >= 500:
        log.warning("proxy.backend_5xx", backend_status=status_code)
        status_code = 502

    # Build response headers (strip hop-by-hop from response too)
    response_headers: dict[str, str] = {}
    for key, value in backend_response.headers.items():
        if key.lower() not in HOP_BY_HOP_HEADERS and key.lower() != "content-encoding":
            response_headers[key] = value

    # Preserve correlation ID
    if correlation_id:
        response_headers["X-Correlation-ID"] = correlation_id

    return Response(
        content=backend_response.content,
        status_code=status_code,
        headers=response_headers,
        media_type=backend_response.headers.get("content-type"),
    )


async def forward_request_streaming(request: Request) -> StreamingResponse:
    """Forward request and stream the response body back chunk by chunk."""
    client = await get_client()

    path = request.url.path
    query = str(request.url.query)
    
    base_url = settings.backend_url
    if path.startswith("/admin/policies") or path.startswith("/admin/posture") or path.startswith("/admin/metrics"):
        base_url = settings.control_plane_url

    if settings.mtls_enabled:
        base_url = base_url.replace("http://", "https://")

    target_url = f"{base_url}{path}"
    if query:
        target_url = f"{target_url}?{query}"

    headers = build_forwarded_headers(request)
    correlation_id = headers.get("X-Correlation-ID", "")
    body = await request.body()

    log = logger.bind(
        correlation_id=correlation_id,
        method=request.method,
        target_url=target_url,
    )

    try:
        log.info("proxy.forwarding.streaming")
        backend_req = client.build_request(
            method=request.method,
            url=target_url,
            headers=headers,
            content=body if body else None,
        )
        backend_response = await client.send(backend_req, stream=True)

    except (httpx.ConnectTimeout, httpx.ReadTimeout):
        log.error("proxy.error.timeout")
        return StreamingResponse(
            content=iter([b'{"error": "Backend timed out", "code": 504}']),
            status_code=504,
            media_type="application/json",
        )
    except httpx.HTTPError as exc:
        log.error("proxy.error.http", error=str(exc))
        return StreamingResponse(
            content=iter([b'{"error": "Bad gateway", "code": 502}']),
            status_code=502,
            media_type="application/json",
        )

    status_code = backend_response.status_code
    if status_code >= 500:
        status_code = 502

    response_headers: dict[str, str] = {}
    for key, value in backend_response.headers.items():
        if key.lower() not in HOP_BY_HOP_HEADERS and key.lower() != "content-encoding":
            response_headers[key] = value

    if correlation_id:
        response_headers["X-Correlation-ID"] = correlation_id

    async def stream_body() -> AsyncIterator[bytes]:
        async for chunk in backend_response.aiter_bytes():
            yield chunk
        await backend_response.aclose()

    return StreamingResponse(
        content=stream_body(),
        status_code=status_code,
        headers=response_headers,
        media_type=backend_response.headers.get("content-type"),
    )
