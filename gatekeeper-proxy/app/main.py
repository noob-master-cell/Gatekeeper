"""Gatekeeper Proxy — Zero-trust reverse proxy application."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime

import structlog
from fastapi import FastAPI, Request, Depends
from fastapi.responses import JSONResponse

from app.auth.keys import get_jwks, initialize_keys
from app.auth.oauth import router as auth_router
from app.auth.sessions import close_redis, init_redis
from app.config import settings
from app.middleware.auth import AuthMiddleware
from app.middleware.correlation import CorrelationIdMiddleware
from app.middleware.logging import RequestLoggingMiddleware
from app.middleware.metrics import MetricsMiddleware
from app.middleware.posture import DevicePostureMiddleware
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

import asyncio
from app.auth.rbac import sync_policies
from app.auth.sessions import get_redis
from app.middleware.posture import sync_posture_rules

async def poll_policies():
    """Periodically fetch RBAC and Posture policies from Redis."""
    while True:
        try:
            r = get_redis()
            await sync_policies(r)
            await sync_posture_rules(r)
        except Exception:
            pass
        await asyncio.sleep(10)


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
            # Start background policy sync
            asyncio.create_task(poll_policies())
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
# 1. Security Headers (adds browser security headers to all responses)
# 2. CORS (handles preflight and cross-origin requests)
# 3. Correlation ID (every request gets a unique ID)
# 4. Logging (logs every request with correlation ID)
# 5. Rate Limiting (blocks excessive requests early)
# 6. Metrics (records success/failure counts)
# 7. Device Posture (blocks bad IPs/UAs before auth)
# 8. Auth (enforces JWT + Redis sessions + RBAC)
app.add_middleware(AuthMiddleware)
from app.middleware.csrf import CSRFMiddleware
app.add_middleware(CSRFMiddleware)
app.add_middleware(DevicePostureMiddleware)
app.add_middleware(MetricsMiddleware)
from app.middleware.ratelimit import RateLimitMiddleware
app.add_middleware(RateLimitMiddleware)
app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(CorrelationIdMiddleware)

from starlette.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.parsed_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["X-Correlation-ID", "X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
)

from app.middleware.security_headers import SecurityHeadersMiddleware
app.add_middleware(SecurityHeadersMiddleware)

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


@app.delete("/admin/sessions/{jti}")
async def delete_session_endpoint(jti: str, request: Request) -> JSONResponse:
    """Kill a single session by its JTI."""
    from app.auth.sessions import revoke_session

    success = await revoke_session(jti)
    if success:
        return JSONResponse(content={"revoked": True, "jti": jti})
    return JSONResponse(
        status_code=404,
        content={"error": "Session not found", "jti": jti},
    )


# ─── Audit log API ────────────────────────────────────────────


@app.get("/admin/audit-logs")
async def list_audit_logs(request: Request) -> JSONResponse:
    """List recent audit log entries from Redis stream."""
    import json

    from app.auth.sessions import get_redis

    count = int(request.query_params.get("count", "50"))
    cursor = request.query_params.get("cursor", "+")
    email_filter = request.query_params.get("email", "").lower()
    path_filter = request.query_params.get("path", "").lower()
    method_filter = request.query_params.get("method", "").upper()
    status_filter = request.query_params.get("status_code", "")

    try:
        r = get_redis()
        logs = []
        max_iterations = 20
        batch_size = max(50, count)
        current_cursor = cursor

        for _ in range(max_iterations):
            entries = await r.xrevrange("audit:log", max=current_cursor, min="-", count=batch_size)
            if not entries:
                break
                
            for entry_id, fields in entries:
                # Redis xrevrange is inclusive of max, so skip the cursor if we explicitly set it
                if cursor != "+" and entry_id == current_cursor and current_cursor == cursor:
                    continue
                    
                data = json.loads(fields["data"])
                
                # Apply optional filters
                if email_filter and email_filter not in str(data.get("email", "")).lower(): continue
                if path_filter and path_filter not in str(data.get("path", "")).lower(): continue
                if method_filter and data.get("method") != method_filter: continue
                if status_filter and str(data.get("status_code")) != status_filter: continue
                
                data["id"] = entry_id
                logs.append(data)
                current_cursor = entry_id
                
                if len(logs) >= count:
                    break
            
            if len(logs) >= count:
                break
                
            # If we only fetched entries we've already seen, break to avoid infinite loop
            last_entry_id = entries[-1][0]
            if current_cursor == last_entry_id and len(entries) == 1:
                break
            current_cursor = last_entry_id

        next_cursor = current_cursor if len(logs) == count else None
        return JSONResponse(content={"data": logs, "count": len(logs), "next_cursor": next_cursor})
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


# ─── RBAC Policy Simulator Sandbox ────────────────────────────

@app.post("/admin/policies/simulate")
async def simulate_policy(request: Request):
    """Simulate exactly how the RBAC engine will handle a hypothetical request."""
    data = await request.json()
    path = data.get("path", "/")
    roles = data.get("roles", ["user"])
    email = data.get("email", "sandbox@test.local")
    
    from app.auth.rbac import check_route_access
    allowed, reason = check_route_access(path, roles)
    
    return JSONResponse(content={
        "allowed": allowed,
        "reason": reason,
        "email": email,
        "simulated_roles": roles,
        "path": path,
    })


# ─── Catch-all reverse proxy route ───────────────────────────


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])
@app.api_route("/admin/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])
async def proxy_route_api(request: Request, path: str):
    """Forward /api/* and /admin/* requests to the backend targets."""
    return await forward_request(request)

import os
from fastapi.staticfiles import StaticFiles
from fastapi import HTTPException
from starlette.responses import FileResponse

public_dir = "/tmp/gatekeeper/public"
if os.path.exists(public_dir):
    # Serve the React SPA. This automatically serves index.html at /
    app.mount("/", StaticFiles(directory=public_dir, html=True), name="public")

    # Add a global 404 handler to support React Router SPA navigation
    @app.exception_handler(404)
    async def spa_not_found(request: Request, exc: HTTPException):
        # Don't serve index.html for API missing endpoints
        if request.url.path.startswith("/api/") or request.url.path.startswith("/admin/") or request.url.path.startswith("/auth/"):
            return JSONResponse(status_code=404, content={"error": "Not Found"})
        index_path = os.path.join(public_dir, "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path)
        return JSONResponse(status_code=404, content={"error": "Not Found"})
else:
    # Fallback catch-all if static files aren't built
    @app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])
    async def proxy_route_catchall(request: Request, path: str):
        return await forward_request(request)
