"""Rate limiting middleware — protects sensitive endpoints from abuse.

Uses Redis for distributed rate limit counters with a sliding-window approach.
Different rate limits are applied based on endpoint sensitivity:
  - Auth endpoints (/login, /oauth/*, /auth/*): strict limits
  - Admin API: moderate limits
  - General: permissive limits
"""

from __future__ import annotations

import structlog
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.auth.sessions import get_redis

logger = structlog.get_logger()

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


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Distributed rate limiting using Redis sliding-window counters.

    - Uses client IP as the rate limit key
    - Returns 429 Too Many Requests when the limit is exceeded
    - Includes Retry-After and rate limit headers in responses
    """

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        path = request.url.path

        # Skip rate limiting for health/metrics endpoints
        if path in EXEMPT_PATHS:
            return await call_next(request)

        # Get client IP
        client_ip = request.client.host if request.client else "unknown"
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            client_ip = forwarded.split(",")[0].strip()

        # Look up rate limit tier
        max_requests, window = _get_rate_limit(path)

        # Check rate limit using Redis
        try:
            allowed, current, ttl = await self._check_rate_limit(
                client_ip, path, max_requests, window
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
            )
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
    async def _check_rate_limit(
        client_ip: str, path: str, max_requests: int, window: int
    ) -> tuple[bool, int, int]:
        """Check and increment rate limit counter in Redis.

        Returns:
            Tuple of (allowed, current_count, ttl_seconds).
        """
        r = get_redis()

        # Determine the bucket key based on the rate limit tier
        # We group by path prefix tier, not exact path
        tier = "default"
        for prefixes, _, _ in RATE_LIMITS:
            for prefix in prefixes:
                if path.startswith(prefix) or path == prefix.rstrip("/"):
                    tier = prefix.replace("/", "_").strip("_")
                    break

        key = f"ratelimit:{tier}:{client_ip}"

        pipe = r.pipeline()
        pipe.incr(key)
        pipe.ttl(key)
        results = await pipe.execute()

        current = results[0]
        ttl = results[1]

        # Set expiry on first request in window
        if ttl == -1:
            await r.expire(key, window)
            ttl = window

        return current <= max_requests, current, ttl
