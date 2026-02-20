"""Redis session service — stores and manages authenticated sessions.

Key schema:
    session:{jti} → JSON { user_id, email, roles, exp, created_at }
    user_sessions:{user_id} → Set of jti values (for per-user revocation)
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import redis.asyncio as redis
import structlog

logger = structlog.get_logger()

# Module-level Redis client (initialized at startup)
_redis_client: redis.Redis | None = None


async def init_redis(redis_url: str) -> None:
    """Initialize the Redis connection."""
    global _redis_client  # noqa: PLW0603
    _redis_client = redis.from_url(
        redis_url,
        decode_responses=True,
        retry_on_timeout=True,
    )
    # Test connection
    await _redis_client.ping()
    logger.info("redis.connected", url=redis_url)


async def close_redis() -> None:
    """Close the Redis connection."""
    global _redis_client  # noqa: PLW0603
    if _redis_client:
        await _redis_client.close()
        _redis_client = None
        logger.info("redis.closed")


def get_redis() -> redis.Redis:
    """Get the current Redis client."""
    if _redis_client is None:
        raise RuntimeError("Redis not initialized. Call init_redis() first.")
    return _redis_client


# ─── Session CRUD ─────────────────────────────────────────────


async def create_session(
    jti: str,
    user_id: str,
    email: str,
    roles: list[str],
    ttl_seconds: int,
) -> None:
    """Store a session in Redis.

    Args:
        jti: JWT ID (unique token identifier).
        user_id: The user's ID.
        email: The user's email.
        roles: List of role names.
        ttl_seconds: Time-to-live in seconds (matches JWT expiry).
    """
    r = get_redis()
    session_data = {
        "user_id": user_id,
        "email": email,
        "roles": roles,
        "created_at": datetime.now(UTC).isoformat(),
    }

    # Store session
    await r.setex(f"session:{jti}", ttl_seconds, json.dumps(session_data))

    # Track session under user (for per-user revocation)
    await r.sadd(f"user_sessions:{user_id}", jti)
    await r.expire(f"user_sessions:{user_id}", ttl_seconds)

    logger.info("session.created", jti=jti, user_id=user_id, email=email, ttl=ttl_seconds)


async def get_session(jti: str) -> dict[str, Any] | None:
    """Retrieve a session from Redis.

    Returns:
        Session data dict, or None if not found (expired/revoked).
    """
    r = get_redis()
    data = await r.get(f"session:{jti}")
    if not data:
        return None
    return json.loads(data)


async def revoke_session(jti: str) -> bool:
    """Revoke a single session by deleting it from Redis.

    Returns:
        True if the session existed and was deleted.
    """
    r = get_redis()
    deleted = await r.delete(f"session:{jti}")
    if deleted:
        logger.info("session.revoked", jti=jti)
    return deleted > 0


async def revoke_all_user_sessions(user_id: str) -> int:
    """Revoke ALL sessions for a given user.

    Returns:
        Number of sessions revoked.
    """
    r = get_redis()
    session_key = f"user_sessions:{user_id}"
    jtis = await r.smembers(session_key)

    if not jtis:
        return 0

    # Delete all session keys
    pipeline = r.pipeline()
    for jti in jtis:
        pipeline.delete(f"session:{jti}")
    pipeline.delete(session_key)
    await pipeline.execute()

    count = len(jtis)
    logger.info("session.revoked_all", user_id=user_id, count=count)
    return count


async def list_active_sessions() -> list[dict[str, Any]]:
    """List all active sessions (for admin dashboard).

    Returns:
        List of session dicts with jti included.
    """
    r = get_redis()
    sessions = []

    # Scan for session:* keys
    async for key in r.scan_iter(match="session:*", count=100):
        jti = key.replace("session:", "")
        data = await r.get(key)
        if data:
            session = json.loads(data)
            session["jti"] = jti
            ttl = await r.ttl(key)
            session["ttl_seconds"] = ttl
            sessions.append(session)

    return sessions


async def get_session_roles(jti: str) -> list[str] | None:
    """Quick lookup: get just the roles for a session.

    Returns:
        List of role names, or None if session not found.
    """
    session = await get_session(jti)
    if session is None:
        return None
    return session.get("roles", [])
