"""Traffic metrics middleware — tracks request outcomes in Redis.

Records:
  - Hourly success/blocked counters (for the 24 h graph)
  - Top requested paths    (ZINCRBY sorted set, daily)
  - Top blocked client IPs (ZINCRBY sorted set, daily)
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Callable

import structlog
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from app.auth.sessions import get_redis

logger = structlog.get_logger()

# Paths we never record to avoid self-referencing noise
_SKIP_PATHS = frozenset({"/proxy/health", "/metrics", "/.well-known/jwks.json"})

# TTLs
_HOURLY_TTL = 48 * 3600     # 48 hours
_DAILY_TTL  = 7 * 24 * 3600 # 7 days


class MetricsMiddleware(BaseHTTPMiddleware):
    """Lightweight, fire-and-forget metrics collection per request."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        try:
            response = await call_next(request)
            status_code = response.status_code
        except Exception:
            status_code = 500
            raise
        finally:
            path = request.url.path
            if path not in _SKIP_PATHS and not path.startswith("/admin/"):
                client_ip = request.client.host if request.client else "unknown"
                await self._record(path, status_code, client_ip)

        return response

    # ──────────────────────────────────────────────────────────
    async def _record(self, path: str, status_code: int, client_ip: str) -> None:
        try:
            r = get_redis()
        except RuntimeError:
            return

        now = datetime.now(UTC)
        hour_key = now.strftime("%Y-%m-%d-%H")
        day_key  = now.strftime("%Y-%m-%d")

        is_success = 200 <= status_code < 400
        bucket = "success" if is_success else "blocked"

        pipe = r.pipeline(transaction=False)

        # 1. Hourly counter (existing — powers the 24 h graph)
        hourly_k = f"traffic:{bucket}:{hour_key}"
        pipe.incr(hourly_k)
        pipe.expire(hourly_k, _HOURLY_TTL)

        # 2. Top requested paths  (sorted set, daily)
        top_paths_k = f"traffic:top_paths:{day_key}"
        pipe.zincrby(top_paths_k, 1, path)
        pipe.expire(top_paths_k, _DAILY_TTL)

        # 3. Top blocked IPs (sorted set, daily — only recorded for blocked)
        if not is_success:
            top_ips_k = f"traffic:top_blocked_ips:{day_key}"
            pipe.zincrby(top_ips_k, 1, client_ip)
            pipe.expire(top_ips_k, _DAILY_TTL)

        try:
            await pipe.execute()
        except Exception as e:
            logger.warning("metrics.record_failed", error=str(e))
