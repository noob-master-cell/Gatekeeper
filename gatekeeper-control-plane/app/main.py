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

    # Seed roles
    async with async_session() as session:
        try:
            await seed_roles(session)
        except Exception as exc:
            logger.warning("control_plane.seed_failed", error=str(exc))

    yield

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

    async with async_session() as session:
        user = await upsert_user(
            session,
            email=email,
            google_id=body.get("google_id"),
            name=body.get("name"),
            default_role=body.get("role", "user"),
        )
    return JSONResponse(
        content={
            "id": user.id,
            "email": user.email,
            "roles": user.role_names(),
        }
    )


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
