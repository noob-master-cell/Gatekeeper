"""Route-level RBAC — maps routes to required roles and enforces access.

Design:
- Policy map defines which roles can access which route patterns
- Supports exact matches and prefix matches
- Default policy: any authenticated user can access unmatched routes
- In-memory TTL cache reduces Redis round-trips for hot paths
"""

from __future__ import annotations

import json
import re
import time

import redis.asyncio as aioredis
import structlog

logger = structlog.get_logger()


# ─── Route Policy Map ────────────────────────────────────────
# Each entry: (pattern, required_roles)
# Patterns are checked in order; first match wins.
# "ANY_AUTHENTICATED" means any valid token is sufficient.

ANY_AUTHENTICATED = "__any_authenticated__"

ROUTE_POLICIES: list[tuple[str, list[str] | str]] = [
    # Admin routes — admin only
    (r"^/api/admin(/.*)?$", ["admin"]),
    (r"^/admin(/.*)?$", ["admin"]),
    # HR routes — hr and admin
    (r"^/api/hr(/.*)?$", ["hr", "admin"]),
    # Default — any authenticated user
    (r"^/.*$", ANY_AUTHENTICATED),
]

# Compiled regex cache
_compiled_policies: list[tuple[re.Pattern, list[str] | str]] = [
    (re.compile(pattern), roles) for pattern, roles in ROUTE_POLICIES
]

# ─── In-memory TTL cache for route access decisions ──────────
# Avoids recompiling and rerunning regex for every single request
# Cache key: (path, frozenset(user_roles)) → (allowed, reason, expires_at)

_ACCESS_CACHE: dict[tuple[str, frozenset[str]], tuple[bool, str, float]] = {}
_CACHE_TTL = 30.0  # seconds
_CACHE_MAX_SIZE = 2048


def _cache_get(path: str, user_roles: list[str]) -> tuple[bool, str] | None:
    """Check the in-memory cache for a previous access decision."""
    key = (path, frozenset(user_roles))
    entry = _ACCESS_CACHE.get(key)
    if entry is None:
        return None
    allowed, reason, expires_at = entry
    if time.monotonic() > expires_at:
        del _ACCESS_CACHE[key]
        return None
    return allowed, reason


def _cache_set(path: str, user_roles: list[str], allowed: bool, reason: str) -> None:
    """Store an access decision in the in-memory cache."""
    if len(_ACCESS_CACHE) >= _CACHE_MAX_SIZE:
        # Evict expired entries first, then oldest quarter
        now = time.monotonic()
        expired = [k for k, v in _ACCESS_CACHE.items() if v[2] < now]
        for k in expired:
            del _ACCESS_CACHE[k]
        if len(_ACCESS_CACHE) >= _CACHE_MAX_SIZE:
            # Evict oldest 25%
            to_evict = list(_ACCESS_CACHE.keys())[: _CACHE_MAX_SIZE // 4]
            for k in to_evict:
                del _ACCESS_CACHE[k]

    key = (path, frozenset(user_roles))
    _ACCESS_CACHE[key] = (allowed, reason, time.monotonic() + _CACHE_TTL)


def check_route_access(path: str, user_roles: list[str]) -> tuple[bool, str]:
    """Check if a user with given roles can access the specified path.

    Uses an in-memory TTL cache to avoid redundant regex evaluations.

    Args:
        path: The request path (e.g., "/api/hr/employees").
        user_roles: The user's role names (e.g., ["user", "hr"]).

    Returns:
        Tuple of (allowed: bool, reason: str).
    """
    # Check cache first
    cached = _cache_get(path, user_roles)
    if cached is not None:
        return cached

    # Evaluate against compiled policies
    for pattern, required_roles in _compiled_policies:
        if pattern.match(path):
            if required_roles == ANY_AUTHENTICATED:
                result = (True, "any_authenticated")
                _cache_set(path, user_roles, *result)
                return result

            # Check if user has at least one of the required roles
            if isinstance(required_roles, list):
                overlap = set(user_roles) & set(required_roles)
                if overlap:
                    result = (True, f"role_match:{','.join(overlap)}")
                    _cache_set(path, user_roles, *result)
                    return result
                else:
                    logger.warning(
                        "rbac.denied",
                        path=path,
                        user_roles=user_roles,
                        required_roles=required_roles,
                    )
                    result = (False, f"requires_one_of:{','.join(required_roles)}")
                    _cache_set(path, user_roles, *result)
                    return result

    # No policy matched — allow by default (shouldn't happen with catch-all)
    result = (True, "no_policy_match")
    _cache_set(path, user_roles, *result)
    return result


def get_required_roles(path: str) -> list[str] | str:
    """Get the required roles for a path (for documentation/debugging)."""
    for pattern, required_roles in _compiled_policies:
        if pattern.match(path):
            return required_roles
    return ANY_AUTHENTICATED


async def sync_policies(redis_client: aioredis.Redis) -> None:
    """Fetch updated route policies from Redis and compile them."""
    global ROUTE_POLICIES, _compiled_policies
    try:
        data = await redis_client.get("rbac:policies")
        if data:
            policies = json.loads(data)
            new_compiled = []
            for pattern, required_roles in policies:
                new_compiled.append((re.compile(pattern), required_roles))
            ROUTE_POLICIES = policies
            _compiled_policies = new_compiled
            # Invalidate the access cache when policies change
            _ACCESS_CACHE.clear()
            logger.debug("rbac.policies_synced", count=len(policies))
    except Exception as exc:
        logger.error("rbac.sync_failed", error=str(exc))
