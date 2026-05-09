"""Rate limiting middleware — token bucket via atomic Lua script with per-IP + per-API-key support.

Uses Redis for distributed rate limiting with an atomic token bucket algorithm
executed via EVALSHA — no race conditions possible.
Different rate limits are applied based on endpoint sensitivity:
  - Auth endpoints (/login, /oauth/*, /auth/*): strict limits
  - Admin API: moderate limits
  - General: permissive limits

API key requests use per-key rate limits stored in key metadata.
"""

from __future__ import annotations

import os
import time

import structlog
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.auth.sessions import get_redis

logger = structlog.get_logger()

# ─── Lua script caching ──────────────────────────────────────

_LUA_SCRIPT: str | None = None  # raw Lua source
_LUA_SHA: str | None = None     # SHA after SCRIPT LOAD


def _lua_source() -> str:
    global _LUA_SCRIPT  # noqa: PLW0603
    if _LUA_SCRIPT is None:
        path = os.path.join(os.path.dirname(__file__), "token_bucket.lua")
        with open(path) as f:
            _LUA_SCRIPT = f.read()
    return _LUA_SCRIPT


async def _get_sha(r) -> str:
    global _LUA_SHA  # noqa: PLW0603
    if _LUA_SHA is None:
        _LUA_SHA = await r.script_load(_lua_source())
    return _LUA_SHA


# ─── Rate limit tiers (max requests, window in seconds) ──────

RATE_LIMITS: list[tuple[list[str], int, int]] = [
    # (path_prefixes, max_requests, window_seconds)
    (["/login", "/oauth/", "/auth/dev-login"], 10, 60),      # Auth: 10 req/min
    (["/admin/sessions/revoke", "/auth/logout"], 20, 60),     # Destructive: 20 req/min
    (["/admin/"], 60, 60),                                    # Admin API: 60 req/min
]

# Default rate limit for all other endpoints
DEFAULT_MAX = 200
DEFAULT_WINDOW = 60  # 200 req/min

# Endpoints exempt from rate limiting
EXEMPT_PATHS = frozenset({"/proxy/health", "/health", "/metrics", "/.well-known/jwks.json"})


def _get_rate_limit(path: str) -> tuple[int, int]:
    """Return (max_requests, window_seconds) for a given path."""
    for prefixes, max_req, window in RATE_LIMITS:
        for prefix in prefixes:
            if path.startswith(prefix) or path == prefix.rstrip("/"):
                return max_req, window
    return DEFAULT_MAX, DEFAULT_WINDOW


def _get_tier_name(path: str) -> str:
    """Get the rate limit tier name for a path."""
    for prefixes, _, _ in RATE_LIMITS:
        for prefix in prefixes:
            if path.startswith(prefix) or path == prefix.rstrip("/"):
                return prefix.replace("/", "_").strip("_")
    return "default"


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Distributed rate limiting using token bucket via atomic Lua script.

    - Uses client IP as the default rate limit key
    - Uses API key hash for API-key-authenticated requests
    - Returns 429 Too Many Requests when the limit is exceeded
    - Includes Retry-After and rate limit headers in responses
    - Token bucket state is updated atomically via Redis EVALSHA — no race conditions
    """

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        path = request.url.path

        # Skip rate limiting for health/metrics endpoints
        if path in EXEMPT_PATHS:
            return await call_next(request)

        # Determine rate limit key and limits
        api_key_header = request.headers.get("X-API-Key", "")
        client_ip = self._get_client_ip(request)

        if api_key_header:
            # Per-API-key rate limiting
            rate_key, max_requests, window = await self._get_apikey_rate_limit(
                api_key_header, path
            )
        else:
            # Per-IP rate limiting
            tier = _get_tier_name(path)
            max_requests, window = _get_rate_limit(path)
            rate_key = f"ratelimit:{tier}:{client_ip}"

        # Check rate limit using Redis
        try:
            allowed, current, ttl = await self._check_rate_limit(
                rate_key, max_requests, window
            )
        except Exception:
            # If Redis is down, fail open (allow the request)
            return await call_next(request)

        if not allowed:
            logger.warning(
                "ratelimit.exceeded",
                client_ip=client_ip,
                path=path,
                current=current,
                limit=max_requests,
                rate_key=rate_key,
            )

            # Track metrics
            try:
                from app.observability.prometheus_metrics import RATE_LIMIT_HITS
                tier = _get_tier_name(path)
                RATE_LIMIT_HITS.labels(client_ip=client_ip, tier=tier).inc()
            except Exception:
                pass

            return JSONResponse(
                status_code=429,
                content={
                    "error": "Too many requests",
                    "retry_after": ttl,
                },
                headers={
                    "Retry-After": str(ttl),
                    "X-RateLimit-Limit": str(max_requests),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": str(ttl),
                },
            )

        response = await call_next(request)

        # Add rate limit headers to successful responses
        remaining = max(0, max_requests - current)
        response.headers["X-RateLimit-Limit"] = str(max_requests)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        response.headers["X-RateLimit-Reset"] = str(ttl)

        return response

    @staticmethod
    def _get_client_ip(request: Request) -> str:
        """Extract client IP, respecting X-Forwarded-For."""
        client_ip = request.client.host if request.client else "unknown"
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            client_ip = forwarded.split(",")[0].strip()
        return client_ip

    @staticmethod
    async def _get_apikey_rate_limit(
        raw_key: str, path: str
    ) -> tuple[str, int, int]:
        """Get rate limit config for an API key request."""
        import hashlib

        key_hash = hashlib.sha256(raw_key.encode()).hexdigest()[:16]
        rate_key = f"ratelimit:apikey:{key_hash}"

        # Try to get per-key rate limit from Redis
        try:
            from app.auth.api_keys import _hash_key
            import json

            r = get_redis()
            full_hash = _hash_key(raw_key)
            data = await r.get(f"apikey:{full_hash}")
            if data:
                metadata = json.loads(data)
                max_req = metadata.get("rate_limit", 1000)
                return rate_key, max_req, 60
        except Exception:
            pass

        # Fallback to path-based limits
        max_req, window = _get_rate_limit(path)
        return rate_key, max_req, window

    @staticmethod
    async def _check_rate_limit(
        key: str, max_requests: int, window: int
    ) -> tuple[bool, int, int]:
        """Atomic token bucket check via Redis Lua EVALSHA.

        capacity    = max_requests
        refill_rate = max_requests / window  (tokens/sec)

        Returns (allowed, remaining_tokens, retry_after_seconds).
        """
        global _LUA_SHA  # noqa: PLW0603
        r = get_redis()
        capacity    = max_requests
        refill_rate = max_requests / window          # tokens per second
        now_ms      = int(time.time() * 1000)

        sha = await _get_sha(r)
        try:
            result = await r.evalsha(
                sha, 1, key,
                str(capacity), str(refill_rate), str(now_ms), "1",
            )
        except Exception:
            # Script not cached (Redis restart) — reload and retry once
            _LUA_SHA = None  # reset cached SHA
            sha = await _get_sha(r)
            result = await r.evalsha(
                sha, 1, key,
                str(capacity), str(refill_rate), str(now_ms), "1",
            )

        allowed      = int(result[0]) == 1
        remaining    = int(result[1])
        retry_ms     = int(result[2])
        retry_s      = max(1, (retry_ms + 999) // 1000)  # ceil to seconds

        return allowed, capacity - remaining, retry_s
