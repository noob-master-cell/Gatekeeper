"""Gatekeeper Proxy — Zero-trust reverse proxy application."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime

import structlog
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.auth.keys import get_jwks, initialize_keys
from app.auth.oauth import router as auth_router
from app.middleware.auth import AuthMiddleware
from app.middleware.correlation import CorrelationIdMiddleware
from app.middleware.logging import RequestLoggingMiddleware
from app.proxy import close_client, forward_request

# ─── Structured logging setup ────────────────────────────────

structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.dev.ConsoleRenderer(),
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
    # Initialize RSA keys for JWT signing
    initialize_keys()
    logger.info("proxy.keys_initialized", message="RSA keys ready")
    yield
    logger.info("proxy.shutting_down", message="Closing HTTP client pool")
    await close_client()


# ─── FastAPI application ──────────────────────────────────────

app = FastAPI(
    title="Gatekeeper Proxy",
    description="Zero-trust reverse proxy with authentication, RBAC, and audit logging.",
    version="0.2.0",
    lifespan=lifespan,
)

# Add middleware (order matters: outermost middleware runs first)
# 1. Correlation ID (outermost — every request gets an ID)
# 2. Logging (logs every request with correlation ID)
# 3. Auth (enforces JWT — must run after correlation ID is set)
app.add_middleware(AuthMiddleware)
app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(CorrelationIdMiddleware)

# Mount auth routes
app.include_router(auth_router)


# ─── Health check (proxy's own health) ────────────────────────


@app.get("/proxy/health")
async def proxy_health() -> dict:
    """Proxy's own health check — NOT forwarded to backend."""
    return {
        "status": "ok",
        "service": "gatekeeper-proxy",
        "version": "0.2.0",
        "timestamp": datetime.now(UTC).isoformat(),
    }


# ─── JWKS endpoint ───────────────────────────────────────────


@app.get("/.well-known/jwks.json")
async def jwks_endpoint() -> JSONResponse:
    """Expose public keys for JWT verification (JWKS format)."""
    return JSONResponse(content=get_jwks())


# ─── Catch-all reverse proxy route ───────────────────────────


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])
async def proxy_route(request: Request, path: str):
    """Forward all requests to the backend target."""
    return await forward_request(request)
