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
from app.auth.sessions import close_redis, init_redis
from app.config import settings
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

    # Initialize Redis for sessions
    if settings.redis_url:
        try:
            await init_redis(settings.redis_url)
        except Exception as exc:
            logger.warning("proxy.redis_init_failed", error=str(exc))

    yield

    logger.info("proxy.shutting_down", message="Closing connections")
    await close_redis()
    await close_client()


# ─── FastAPI application ──────────────────────────────────────

app = FastAPI(
    title="Gatekeeper Proxy",
    description="Zero-trust reverse proxy with authentication, RBAC, and audit logging.",
    version="0.4.0",
    lifespan=lifespan,
)

# Add middleware (order matters: outermost middleware runs first)
# 1. Correlation ID (outermost — every request gets an ID)
# 2. Logging (logs every request with correlation ID)
# 3. Auth (enforces JWT + Redis sessions + RBAC)
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
        "version": "0.4.0",
        "timestamp": datetime.now(UTC).isoformat(),
    }


# ─── JWKS endpoint ───────────────────────────────────────────


@app.get("/.well-known/jwks.json")
async def jwks_endpoint() -> JSONResponse:
    """Expose public keys for JWT verification (JWKS format)."""
    return JSONResponse(content=get_jwks())


# ─── Admin session management (proxy-side) ────────────────────


@app.get("/admin/sessions")
async def list_sessions(request: Request) -> JSONResponse:
    """List all active sessions from Redis."""
    from app.auth.sessions import list_active_sessions

    try:
        sessions = await list_active_sessions()
    except RuntimeError:
        return JSONResponse(content={"data": [], "count": 0, "note": "Redis not initialized"})
    return JSONResponse(content={"data": sessions, "count": len(sessions)})


@app.post("/admin/sessions/revoke")
async def revoke_session_endpoint(request: Request) -> JSONResponse:
    """Revoke a session by JTI or all sessions for a user."""
    from app.auth.sessions import revoke_all_user_sessions, revoke_session

    body = await request.json()
    jti = body.get("jti")
    user_id = body.get("user_id")

    if jti:
        success = await revoke_session(jti)
        return JSONResponse(
            content={"revoked": success, "jti": jti},
            status_code=200 if success else 404,
        )
    elif user_id:
        count = await revoke_all_user_sessions(user_id)
        return JSONResponse(content={"revoked_count": count, "user_id": user_id})
    else:
        return JSONResponse(
            status_code=400,
            content={"error": "Provide either 'jti' or 'user_id' to revoke"},
        )


# ─── Audit log API ────────────────────────────────────────────


@app.get("/admin/audit-logs")
async def list_audit_logs(request: Request) -> JSONResponse:
    """List recent audit log entries from Redis stream."""
    import json

    from app.auth.sessions import get_redis

    count = int(request.query_params.get("count", "50"))
    try:
        r = get_redis()
        # Read last N entries from audit:log stream
        entries = await r.xrevrange("audit:log", count=min(count, 500))
        logs = []
        for entry_id, fields in entries:
            data = json.loads(fields["data"])
            data["id"] = entry_id
            logs.append(data)
        return JSONResponse(content={"data": logs, "count": len(logs)})
    except RuntimeError:
        return JSONResponse(content={"data": [], "count": 0, "note": "Redis not initialized"})
    except Exception as exc:
        return JSONResponse(
            status_code=503,
            content={"error": "Audit log unavailable", "detail": str(exc)},
        )


# ─── Prometheus-style metrics ─────────────────────────────────


@app.get("/metrics")
async def metrics() -> JSONResponse:
    """Basic operational metrics (Prometheus-compatible JSON)."""
    import os

    return JSONResponse(
        content={
            "service": "gatekeeper-proxy",
            "version": "0.4.0",
            "uptime": "running",
            "python_version": os.sys.version,
        }
    )


# ─── Catch-all reverse proxy route ───────────────────────────


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])
async def proxy_route(request: Request, path: str):
    """Forward all requests to the backend target."""
    return await forward_request(request)
