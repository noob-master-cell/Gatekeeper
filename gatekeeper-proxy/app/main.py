"""Gatekeeper Proxy — Zero-trust reverse proxy application."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime

import structlog
from fastapi import FastAPI, Request

from app.middleware.correlation import CorrelationIdMiddleware
from app.middleware.logging import RequestLoggingMiddleware
from app.proxy import close_client, forward_request

# ─── Structured logging setup ────────────────────────────────

structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.dev.ConsoleRenderer()
        if True  # Use JSON in production
        else structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(0),
    context_class=dict,
    logger_factory=structlog.PrintLoggerFactory(),
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger()


# ─── App lifecycle ────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Manage application lifecycle — startup and shutdown."""
    logger.info("proxy.starting", message="Gatekeeper Proxy is starting")
    yield
    logger.info("proxy.shutting_down", message="Closing HTTP client pool")
    await close_client()


# ─── FastAPI application ──────────────────────────────────────

app = FastAPI(
    title="Gatekeeper Proxy",
    description="Zero-trust reverse proxy with authentication, RBAC, and audit logging.",
    version="0.1.0",
    lifespan=lifespan,
)

# Add middleware (order matters: correlation first, then logging)
app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(CorrelationIdMiddleware)


# ─── Health check (proxy's own health) ────────────────────────


@app.get("/proxy/health")
async def proxy_health() -> dict:
    """Proxy's own health check — NOT forwarded to backend."""
    return {
        "status": "ok",
        "service": "gatekeeper-proxy",
        "timestamp": datetime.now(UTC).isoformat(),
    }


# ─── Catch-all reverse proxy route ───────────────────────────


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])
async def proxy_route(request: Request, path: str):
    """Forward all requests to the backend target."""
    return await forward_request(request)
