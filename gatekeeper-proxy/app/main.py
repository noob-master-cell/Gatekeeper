"""Gatekeeper Proxy — Zero-trust reverse proxy application.

Middleware stack (outermost runs first):
  Security Headers → CORS → Correlation ID → Prometheus → Logging →
  Rate Limiting → CSRF → Device Posture → Auth (JWT + API keys + RBAC + OPA)
"""

from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime

import structlog
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.auth.keys import get_jwks, initialize_keys
from app.auth.oauth import router as auth_router
from app.auth.rbac import sync_policies
from app.auth.sessions import close_redis, get_redis, init_redis
from app.config import settings
from app.middleware.auth import AuthMiddleware
from app.middleware.correlation import CorrelationIdMiddleware
from app.middleware.csrf import CSRFMiddleware
from app.middleware.logging import RequestLoggingMiddleware
from app.middleware.metrics import MetricsMiddleware
from app.middleware.posture import DevicePostureMiddleware, sync_posture_rules
from app.middleware.ratelimit import RateLimitMiddleware
from app.middleware.security_headers import SecurityHeadersMiddleware
from app.observability.logging_config import configure_logging
from app.observability.prometheus_metrics import PrometheusMiddleware, get_metrics_response
from app.observability.tracing import init_tracing, instrument_fastapi, instrument_httpx
from app.proxy import close_client, forward_request

# ─── Version ─────────────────────────────────────────────────

__version__ = "0.2.0"

# ─── Structured logging setup ────────────────────────────────

configure_logging()
logger = structlog.get_logger()


# ─── App lifecycle ────────────────────────────────────────────


async def poll_policies() -> None:
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
    logger.info("proxy.starting", version=__version__)

    # Initialize OpenTelemetry tracing
    init_tracing(service_name="gatekeeper-proxy")
    instrument_httpx()

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

    # Close OPA client if initialized
    try:
        from app.auth.opa import close_opa_client
        await close_opa_client()
    except Exception:
        pass


# ─── FastAPI application ──────────────────────────────────────

app = FastAPI(
    title="Gatekeeper Proxy",
    description="Zero-trust reverse proxy with authentication, RBAC, OPA, and observability.",
    version=__version__,
    lifespan=lifespan,
)

# Instrument FastAPI with OpenTelemetry
instrument_fastapi(app)

# ─── Middleware stack (order matters: outermost middleware runs first) ──
# 1. Security Headers — adds HSTS, CSP, X-Frame-Options to all responses
# 2. CORS — handles preflight and cross-origin requests
# 3. Correlation ID — every request gets a unique ID
# 4. Prometheus — collects latency, counts, active connections
# 5. Logging — structured request logging with audit trail
# 6. Metrics — Redis-backed traffic counters for the 24h dashboard graph
# 7. Rate Limiting — token bucket per IP + per API key
# 8. CSRF — validates Origin header on state-changing requests
# 9. Device Posture — blocks bad IPs/UAs before auth
# 10. Auth — JWT + API keys + Redis sessions + RBAC + OPA

app.add_middleware(AuthMiddleware)
app.add_middleware(DevicePostureMiddleware)
app.add_middleware(CSRFMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(MetricsMiddleware)
app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(PrometheusMiddleware)
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

app.add_middleware(SecurityHeadersMiddleware)

# Mount auth routes
app.include_router(auth_router)


# ─── Health check ─────────────────────────────────────────────


@app.get("/proxy/health")
async def proxy_health() -> dict:
    """Proxy's own health check — NOT forwarded to backend."""
    return {
        "status": "ok",
        "service": "gatekeeper-proxy",
        "version": __version__,
        "timestamp": datetime.now(UTC).isoformat(),
    }


# ─── Prometheus metrics endpoint ─────────────────────────────


@app.get("/metrics")
async def metrics():
    """Prometheus text-format metrics endpoint."""
    return get_metrics_response()


# ─── JWKS endpoint ───────────────────────────────────────────


@app.get("/.well-known/jwks.json")
async def jwks_endpoint() -> JSONResponse:
    """Expose public keys for JWT verification (JWKS format)."""
    return JSONResponse(content=get_jwks())


# ─── Admin session management ────────────────────────────────


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


# ─── API key management ─────────────────────────────────────


@app.post("/admin/api-keys")
async def create_api_key_endpoint(request: Request) -> JSONResponse:
    """Create a new API key."""
    from app.auth.api_keys import create_api_key

    body = await request.json()
    result = await create_api_key(
        name=body.get("name", "Unnamed Key"),
        owner=body.get("owner", "admin"),
        roles=body.get("roles", ["user"]),
        rate_limit=body.get("rate_limit", 1000),
    )
    return JSONResponse(content=result, status_code=201)


@app.get("/admin/api-keys")
async def list_api_keys_endpoint(request: Request) -> JSONResponse:
    """List all API keys."""
    from app.auth.api_keys import list_api_keys

    owner = request.query_params.get("owner")
    keys = await list_api_keys(owner=owner)
    return JSONResponse(content={"data": keys, "count": len(keys)})


@app.delete("/admin/api-keys/{key_hash}")
async def revoke_api_key_endpoint(key_hash: str, request: Request) -> JSONResponse:
    """Revoke an API key."""
    from app.auth.api_keys import revoke_api_key

    success = await revoke_api_key(key_hash)
    if success:
        return JSONResponse(content={"revoked": True})
    return JSONResponse(status_code=404, content={"error": "API key not found"})


# ─── Audit log API ───────────────────────────────────────────


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


# ─── RBAC Policy Simulator Sandbox ──────────────────────────


@app.post("/admin/policies/simulate")
async def simulate_policy(request: Request):
    """Simulate how the full auth stack (RBAC + OPA) handles a hypothetical request."""
    data = await request.json()
    path = data.get("path", "/")
    roles = data.get("roles", ["user"])
    email = data.get("email", "sandbox@test.local")
    method = data.get("method", "GET")

    from app.auth.rbac import check_route_access
    rbac_allowed, rbac_reason = check_route_access(path, roles, method)

    # Final decision starts with RBAC
    allowed = rbac_allowed
    reason = rbac_reason

    result = {
        "email": email,
        "simulated_roles": roles,
        "path": path,
        "method": method,
        "rbac_allowed": rbac_allowed,
        "rbac_reason": rbac_reason,
    }

    # OPA is the second gate — both must pass (AND logic, matching production)
    if settings.opa_enabled:
        try:
            from app.auth.opa import evaluate_policy
            opa_allowed, opa_reason = await evaluate_policy(
                method=method,
                path=path,
                user_id=f"simulator:{email}",
                email=email,
                roles=roles,
                client_ip="127.0.0.1",
            )
            result["opa_allowed"] = opa_allowed
            result["opa_reason"] = opa_reason

            # OPA denial overrides RBAC allow
            if not opa_allowed:
                allowed = False
                reason = opa_reason
        except Exception as exc:
            result["opa_error"] = str(exc)

    result["allowed"] = allowed
    result["reason"] = reason

    return JSONResponse(content=result)


# ─── Circuit breaker status ──────────────────────────────────


@app.get("/admin/circuit-breakers")
async def circuit_breaker_status(request: Request) -> JSONResponse:
    """Return current state of all circuit breakers."""
    from app.circuit_breaker import backend_cb, control_plane_cb
    return JSONResponse(content={
        "data": [backend_cb.status(), control_plane_cb.status()]
    })


# ─── System status ──────────────────────────────────────────


@app.get("/admin/status")
async def admin_status(request: Request) -> JSONResponse:
    """Return current proxy feature flags and system health."""
    redis_ok = False
    try:
        r = get_redis()
        await r.ping()
        redis_ok = True
    except Exception:
        pass

    from app.circuit_breaker import backend_cb, control_plane_cb
    return JSONResponse(content={
        "opa_enabled": settings.opa_enabled,
        "mtls_enabled": settings.mtls_enabled,
        "redis_ok": redis_ok,
        "dev_mode": settings.dev_mode,
        "version": __version__,
        "circuit_breakers": [backend_cb.status(), control_plane_cb.status()],
    })


# ─── Rate limit counters ─────────────────────────────────────


@app.get("/admin/rate-limits")
async def list_rate_limits(request: Request) -> JSONResponse:
    """Return current rate limit counters from Redis."""
    try:
        r = get_redis()
        results = []
        async for key in r.scan_iter("ratelimit:*"):
            ttl = await r.ttl(key)
            key_str = key if isinstance(key, str) else key.decode()
            parts = key_str.split(":", 2)
            tier = parts[1] if len(parts) > 1 else "unknown"
            identifier = parts[2] if len(parts) > 2 else key_str

            # Token bucket stores a hash: {tokens, ts}
            bucket = await r.hgetall(key)
            if bucket:
                tokens_remaining = float(bucket.get(b"tokens", bucket.get("tokens", 0)))
            else:
                tokens_remaining = 0

            results.append({
                "key": key_str,
                "tier": tier,
                "identifier": identifier,
                "tokens_remaining": round(tokens_remaining, 2),
                "ttl_seconds": ttl,
            })
        results.sort(key=lambda x: x["tokens_remaining"])
        return JSONResponse(content={"data": results, "count": len(results)})
    except RuntimeError:
        return JSONResponse(content={"data": [], "count": 0, "note": "Redis not initialized"})
    except Exception as exc:
        return JSONResponse(status_code=503, content={"error": str(exc)})


# ─── SSE metrics stream ──────────────────────────────────────


@app.get("/admin/stream")
async def event_stream(request: Request):
    """Server-Sent Events stream — pushes metrics snapshot every 3 seconds."""
    import json as _json
    from datetime import UTC, datetime
    from starlette.responses import StreamingResponse

    async def generate():
        while True:
            if await request.is_disconnected():
                break
            try:
                r = get_redis()
                # Get recent audit log entry count
                log_count = await r.xlen("audit:log")
                # Get active session count
                session_count = sum(1 async for _ in r.scan_iter("session:*"))
                # Get rate limit hit count
                rl_count = sum(1 async for _ in r.scan_iter("ratelimit:*"))
            except Exception:
                log_count = 0
                session_count = 0
                rl_count = 0

            payload = _json.dumps({
                "timestamp": datetime.now(UTC).isoformat(),
                "audit_log_entries": log_count,
                "active_sessions": session_count,
                "rate_limited_keys": rl_count,
            })
            yield f"data: {payload}\n\n"
            await asyncio.sleep(3)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ─── OPA policy hot-reload ───────────────────────────────────


@app.get("/admin/opa/policy")
async def get_opa_policy(request: Request) -> JSONResponse:
    """Fetch the current Rego policy from OPA."""
    if not settings.opa_enabled:
        return JSONResponse(status_code=503, content={"error": "OPA not enabled"})
    try:
        from app.auth.opa import get_policy
        policy = await get_policy()
        if policy is None:
            return JSONResponse(status_code=503, content={"error": "Could not fetch policy from OPA"})
        return JSONResponse(content={"policy": policy})
    except Exception as exc:
        return JSONResponse(status_code=503, content={"error": str(exc)})


@app.post("/admin/opa/policy")
async def push_opa_policy(request: Request) -> JSONResponse:
    """Push a new Rego policy to OPA (hot-reload — no proxy restart needed)."""
    if not settings.opa_enabled:
        return JSONResponse(status_code=503, content={"error": "OPA not enabled"})
    try:
        body = await request.json()
        rego = body.get("policy", "")
        if not rego.strip():
            return JSONResponse(status_code=400, content={"error": "Policy text is required"})
        from app.auth.opa import push_policy
        success, reason = await push_policy(rego)
        if success:
            return JSONResponse(content={"pushed": True, "reason": reason})
        return JSONResponse(status_code=422, content={"pushed": False, "reason": reason})
    except Exception as exc:
        return JSONResponse(status_code=500, content={"error": str(exc)})


# ─── Catch-all reverse proxy route ──────────────────────────


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])
@app.api_route("/admin/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])
async def proxy_route_api(request: Request, path: str):
    """Forward /api/* and /admin/* requests to the backend targets."""
    return await forward_request(request)


from fastapi.staticfiles import StaticFiles
from fastapi import HTTPException
from starlette.responses import FileResponse

public_dir = "/tmp/gatekeeper/public"
if os.path.exists(public_dir):
    app.mount("/", StaticFiles(directory=public_dir, html=True), name="public")

    @app.exception_handler(404)
    async def spa_not_found(request: Request, exc: HTTPException):
        if request.url.path.startswith(("/api/", "/admin/", "/auth/")):
            return JSONResponse(status_code=404, content={"error": "Not Found"})
        index_path = os.path.join(public_dir, "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path)
        return JSONResponse(status_code=404, content={"error": "Not Found"})
else:
    @app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])
    async def proxy_route_catchall(request: Request, path: str):
        return await forward_request(request)
