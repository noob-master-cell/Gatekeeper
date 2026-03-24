"""Gatekeeper Control Plane — Admin APIs for RBAC, users, sessions, and roles."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime

import redis.asyncio as aioredis
import structlog
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.config import settings
from app.database import async_session, engine
from app.services.user_service import (
    assign_role,
    list_all_roles,
    list_all_users,
    remove_role,
    seed_roles,
    upsert_user,
)
from app.services.policy_service import (
    create_or_update_policy,
    delete_policy,
    list_all_policies,
    sync_policies_to_redis,
    list_all_posture_rules,
    create_or_update_posture_rule,
    delete_posture_rule,
    sync_posture_to_redis,
)

logger = structlog.get_logger()

# Module-level Redis client
_redis: aioredis.Redis | None = None


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Control plane lifecycle — initialize DB and Redis connections."""
    global _redis  # noqa: PLW0603
    logger.info("control_plane.starting")

    # Connect to Redis
    try:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
        await _redis.ping()
        logger.info("control_plane.redis_connected")
    except Exception as exc:
        logger.warning("control_plane.redis_failed", error=str(exc))
        _redis = None

    # Seed roles and sync policies to Redis
    async with async_session() as session:
        try:
            await seed_roles(session)
            # Define some default policies if none exist
            from app.services.policy_service import ensure_default_policies
            await ensure_default_policies(session)
            
            # Ensure posture rules sync to redis on startup as well
            if _redis:
                await sync_policies_to_redis(session, _redis)
                await sync_posture_to_redis(session, _redis)
        except Exception as exc:
            import traceback
            with open("/tmp/seed_error.txt", "w") as f:
                f.write(traceback.format_exc())
            logger.warning("control_plane.seed_failed", error=str(exc))

    # Start background audit log sync worker
    import asyncio
    _audit_task = None
    if _redis:
        from app.services.audit_sync import sync_audit_logs
        _audit_task = asyncio.create_task(sync_audit_logs(async_session, _redis))
        logger.info("control_plane.audit_sync_started")

    yield

    # Cancel audit sync on shutdown
    if _audit_task and not _audit_task.done():
        _audit_task.cancel()
        try:
            await _audit_task
        except asyncio.CancelledError:
            pass

    if _redis:
        await _redis.close()
    await engine.dispose()
    logger.info("control_plane.stopped")


app = FastAPI(
    title="Gatekeeper Control Plane",
    description="RBAC management, user administration, and session management APIs.",
    version="0.2.0",
    lifespan=lifespan,
)

# Add API key authentication middleware
from app.middleware import APIKeyMiddleware

app.add_middleware(APIKeyMiddleware)

# ─── Health ───────────────────────────────────────────────────


@app.get("/health")
async def health() -> dict:
    """Health check endpoint."""
    return {
        "status": "ok",
        "service": "gatekeeper-control-plane",
        "version": "0.2.0",
        "timestamp": datetime.now(UTC).isoformat(),
    }


# ─── Users API ────────────────────────────────────────────────


@app.get("/admin/users")
async def get_users() -> JSONResponse:
    """List all users with their roles."""
    async with async_session() as session:
        users = await list_all_users(session)
    return JSONResponse(content={"data": users, "count": len(users)})


@app.post("/admin/users")
async def create_or_update_user(request: Request) -> JSONResponse:
    """Create or update a user (upsert by email)."""
    body = await request.json()
    email = body.get("email")
    if not email:
        return JSONResponse(status_code=400, content={"error": "Email is required"})

    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from app.models import User, Role

    async with async_session() as session:
        # Check if user exists
        result = await session.execute(
            select(User).where(User.email == email).options(selectinload(User.roles))
        )
        user = result.scalar_one_or_none()

        if user is None:
            # Create new user
            from datetime import datetime, UTC
            user = User(
                email=email,
                google_id=body.get("google_id"),
                name=body.get("name"),
                created_at=datetime.now(UTC),
                last_login_at=datetime.now(UTC),
            )
            session.add(user)
            await session.flush()

            # Assign role via direct insert to avoid lazy-load on new object
            role_name = body.get("role", "user")
            role_result = await session.execute(select(Role).where(Role.name == role_name))
            role_obj = role_result.scalar_one_or_none()
            if role_obj:
                from app.models import user_roles
                await session.execute(
                    user_roles.insert().values(user_id=user.id, role_id=role_obj.id)
                )
        else:
            # Update existing user
            from datetime import datetime, UTC
            user.last_login_at = datetime.now(UTC)
            if body.get("google_id") and not user.google_id:
                user.google_id = body.get("google_id")
            if body.get("name") and not user.name:
                user.name = body.get("name")

        await session.commit()

        # Re-fetch with eager loading after commit
        fresh = await session.execute(
            select(User).where(User.email == email).options(selectinload(User.roles))
        )
        user = fresh.scalar_one()
        user_id = user.id
        user_email = user.email
        role_list = [r.name for r in user.roles]

    return JSONResponse(content={"id": user_id, "email": user_email, "roles": role_list})


# ─── Roles API ────────────────────────────────────────────────


@app.get("/admin/roles")
async def get_roles() -> JSONResponse:
    """List all available roles."""
    async with async_session() as session:
        roles = await list_all_roles(session)
    return JSONResponse(content={"data": roles, "count": len(roles)})


@app.post("/admin/users/{email}/roles")
async def assign_user_role(email: str, request: Request) -> JSONResponse:
    """Assign a role to a user."""
    body = await request.json()
    role_name = body.get("role")
    if not role_name:
        return JSONResponse(status_code=400, content={"error": "Role name is required"})

    async with async_session() as session:
        success = await assign_role(session, email, role_name)

    if not success:
        return JSONResponse(status_code=404, content={"error": "User or role not found"})
    return JSONResponse(content={"message": f"Role '{role_name}' assigned to {email}"})


@app.delete("/admin/users/{email}/roles/{role_name}")
async def remove_user_role(email: str, role_name: str) -> JSONResponse:
    """Remove a role from a user."""
    async with async_session() as session:
        success = await remove_role(session, email, role_name)

    if not success:
        return JSONResponse(status_code=404, content={"error": "User or role not found"})
    return JSONResponse(content={"message": f"Role '{role_name}' removed from {email}"})


# ─── Session Management ──────────────────────────────────────


@app.get("/admin/sessions")
async def list_sessions() -> JSONResponse:
    """List all active sessions from Redis."""
    if not _redis:
        return JSONResponse(
            status_code=503,
            content={"error": "Redis not available"},
        )

    sessions = []
    async for key in _redis.scan_iter(match="session:*", count=100):
        jti = key.replace("session:", "")
        import json

        data = await _redis.get(key)
        if data:
            session = json.loads(data)
            session["jti"] = jti
            ttl = await _redis.ttl(key)
            session["ttl_seconds"] = ttl
            sessions.append(session)

    return JSONResponse(content={"data": sessions, "count": len(sessions)})


@app.post("/admin/sessions/revoke")
async def revoke_session(request: Request) -> JSONResponse:
    """Revoke a session by JTI or all sessions for a user."""
    if not _redis:
        return JSONResponse(status_code=503, content={"error": "Redis not available"})

    body = await request.json()
    jti = body.get("jti")
    user_id = body.get("user_id")

    if jti:
        deleted = await _redis.delete(f"session:{jti}")
        logger.info("session.revoked", jti=jti, success=deleted > 0)
        return JSONResponse(
            content={"revoked": deleted > 0, "jti": jti},
            status_code=200 if deleted else 404,
        )
    elif user_id:
        # Revoke all sessions for a user
        session_key = f"user_sessions:{user_id}"
        jtis = await _redis.smembers(session_key)
        count = 0
        if jtis:
            pipeline = _redis.pipeline()
            for j in jtis:
                pipeline.delete(f"session:{j}")
            pipeline.delete(session_key)
            await pipeline.execute()
            count = len(jtis)
        logger.info("session.revoked_all", user_id=user_id, count=count)
        return JSONResponse(content={"revoked_count": count, "user_id": user_id})
    else:
        return JSONResponse(
            status_code=400,
            content={"error": "Provide 'jti' or 'user_id'"},
        )


# ─── RBAC Route Policies API ─────────────────────────────────


@app.get("/admin/policies")
async def get_policies() -> JSONResponse:
    """List all route RBAC policies."""
    async with async_session() as session:
        policies = await list_all_policies(session)
    data = []
    for p in policies:
        data.append({
            "id": p.id,
            "name": p.name,
            "description": p.description,
            "pattern": p.pattern,
            "priority": p.priority,
            "is_active": p.is_active,
            "allow_any_authenticated": p.allow_any_authenticated,
            "roles": [r.name for r in p.roles],
        })
    return JSONResponse(content={"data": data, "count": len(data)})


@app.post("/admin/policies")
async def create_policy(request: Request) -> JSONResponse:
    """Create or update a route policy."""
    body = await request.json()
    name = body.get("name")
    pattern = body.get("pattern")
    
    if not name or not pattern:
        return JSONResponse(status_code=400, content={"error": "Name and pattern required"})

    async with async_session() as session:
        policy = await create_or_update_policy(
            session=session,
            name=name,
            pattern=pattern,
            priority=int(body.get("priority", 100)),
            is_active=bool(body.get("is_active", True)),
            allow_any_authenticated=bool(body.get("allow_any_authenticated", False)),
            description=body.get("description"),
            roles=body.get("roles", [])
        )
        if _redis:
            await sync_policies_to_redis(session, _redis)

    return JSONResponse(content={"message": f"Policy '{name}' saved."})


@app.delete("/admin/policies/{name}")
async def remove_policy(name: str) -> JSONResponse:
    """Delete a route policy."""
    async with async_session() as session:
        success = await delete_policy(session, name)
        if success and _redis:
            await sync_policies_to_redis(session, _redis)

    if not success:
        return JSONResponse(status_code=404, content={"error": "Policy not found"})
    return JSONResponse(content={"message": f"Policy '{name}' deleted."})


# ─── Device Posture API ──────────────────────────────────────


@app.get("/admin/posture")
async def get_posture_rules() -> JSONResponse:
    """List all device posture rules."""
    async with async_session() as session:
        rules = await list_all_posture_rules(session)
    data = []
    for r in rules:
        data.append({
            "id": r.id,
            "rule_type": r.rule_type,
            "value": r.value,
            "action": r.action,
            "is_active": r.is_active,
            "description": r.description,
        })
    return JSONResponse(content={"data": data, "count": len(data)})


@app.post("/admin/posture")
async def create_posture_rule(request: Request) -> JSONResponse:
    """Create or update a device posture rule."""
    body = await request.json()
    rule_type = body.get("rule_type")
    value = body.get("value")
    
    if not rule_type or not value:
        return JSONResponse(status_code=400, content={"error": "rule_type and value required"})

    async with async_session() as session:
        rule = await create_or_update_posture_rule(
            session=session,
            rule_type=rule_type,
            value=value,
            action=body.get("action", "block"),
            is_active=bool(body.get("is_active", True)),
            description=body.get("description"),
        )
        if _redis:
            await sync_posture_to_redis(session, _redis)

    return JSONResponse(content={"message": f"Posture rule '{rule_type}:{value}' saved."})


@app.delete("/admin/posture/{rule_id}")
async def remove_posture_rule(rule_id: int) -> JSONResponse:
    """Delete a device posture rule."""
    async with async_session() as session:
        success = await delete_posture_rule(session, rule_id)
        if success and _redis:
            await sync_posture_to_redis(session, _redis)

    if not success:
        return JSONResponse(status_code=404, content={"error": "Rule not found"})
    return JSONResponse(content={"message": f"Rule {rule_id} deleted."})


# ─── Traffic Metrics API ──────────────────────────────────────


@app.get("/admin/metrics/traffic")
async def get_traffic_metrics() -> JSONResponse:
    """Return the last 24 hours of aggregated traffic successes and blocks."""
    if not _redis:
        return JSONResponse(status_code=503, content={"error": "Redis not available"})

    from datetime import datetime, timedelta, UTC

    now = datetime.now(UTC)
    data = []

    # Get the last 24 hours including the current hour
    for i in range(23, -1, -1):
        target_time = now - timedelta(hours=i)
        hour_str = target_time.strftime("%Y-%m-%d-%H")
        
        success_key = f"traffic:success:{hour_str}"
        blocked_key = f"traffic:blocked:{hour_str}"

        # Fetch both counters concurrently
        import asyncio
        success_count, blocked_count = await asyncio.gather(
            _redis.get(success_key),
            _redis.get(blocked_key)
        )

        data.append({
            "time": target_time.strftime("%H:00"),
            "success": int(success_count or 0),
            "blocked": int(blocked_count or 0),
        })

    return JSONResponse(content={"data": data})


@app.get("/admin/metrics/top-paths")
async def get_top_paths() -> JSONResponse:
    """Return today's most requested paths (descending by count)."""
    if not _redis:
        return JSONResponse(status_code=503, content={"error": "Redis not available"})

    from datetime import datetime, UTC

    day_key = datetime.now(UTC).strftime("%Y-%m-%d")
    redis_key = f"traffic:top_paths:{day_key}"

    raw = await _redis.zrevrange(redis_key, 0, 19, withscores=True)
    data = [{"path": path, "count": int(score)} for path, score in raw]

    return JSONResponse(content={"data": data})


@app.get("/admin/metrics/top-blocked-ips")
async def get_top_blocked_ips() -> JSONResponse:
    """Return today's most blocked client IP addresses."""
    if not _redis:
        return JSONResponse(status_code=503, content={"error": "Redis not available"})

    from datetime import datetime, UTC

    day_key = datetime.now(UTC).strftime("%Y-%m-%d")
    redis_key = f"traffic:top_blocked_ips:{day_key}"

    raw = await _redis.zrevrange(redis_key, 0, 19, withscores=True)
    data = [{"ip": ip, "count": int(score)} for ip, score in raw]

    return JSONResponse(content={"data": data})

