"""Device Posture Middleware — blocks outdated browsers, suspicious IPs, or missing user agents.

Enforces zero-trust health checks on the client's connection before authentication.
"""

from __future__ import annotations

import re

import structlog
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.auth.sessions import get_redis
import json
from datetime import UTC, datetime

import redis.asyncio as aioredis

# In-memory posture state (synced from Redis)
_BLOCKED_IPS: set[str] = set()
_BLOCKED_USER_AGENT_PATTERNS: list[re.Pattern] = []

async def sync_posture_rules(redis_client: aioredis.Redis) -> None:
    """Fetch updated posture rules from Redis and compile them."""
    global _BLOCKED_IPS, _BLOCKED_USER_AGENT_PATTERNS
    try:
        data = await redis_client.get("posture:rules")
        if data:
            rules = json.loads(data)
            
            # IPs
            _BLOCKED_IPS = set(rules.get("ip_address", []))
            
            # User Agents
            new_ua_patterns = []
            for ua in rules.get("user_agent", []):
                try:
                    new_ua_patterns.append(re.compile(ua, re.IGNORECASE))
                except re.error as e:
                    logger.warning("posture.invalid_ua_regex", pattern=ua, error=str(e))
            _BLOCKED_USER_AGENT_PATTERNS = new_ua_patterns
            
            logger.debug(
                "posture.rules_synced",
                ips=len(_BLOCKED_IPS),
                user_agents=len(_BLOCKED_USER_AGENT_PATTERNS)
            )
    except Exception as exc:
        logger.error("posture.sync_failed", error=str(exc))


class DevicePostureMiddleware(BaseHTTPMiddleware):
    """Enforces dynamic device posture requirements from Redis.
    
    Checks User-Agent and IP Address against central policies. Logs failures to the audit trail.
    """

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        path = request.url.path
        
        # Skip health/metrics
        if path in {"/proxy/health", "/health", "/metrics"}:
            return await call_next(request)

        # 1. Check IP
        # Naive check of client host or X-Forwarded-For
        client_ip = request.client.host if request.client else "unknown"
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            client_ip = forwarded.split(",")[0].strip()

        if client_ip in _BLOCKED_IPS:
            return await self._reject(request, client_ip, f"Blocked IP Address: {client_ip}")

        # 2. Check User-Agent
        user_agent = request.headers.get("User-Agent", "")
        
        for pattern in _BLOCKED_USER_AGENT_PATTERNS:
            if pattern.search(user_agent):
                return await self._reject(request, client_ip, f"Blocked User-Agent matches: {pattern.pattern}")

        return await call_next(request)

    async def _reject(self, request: Request, client_ip: str, reason: str) -> Response:
        """Reject the request and log an audit event."""
        correlation_id = getattr(request.state, "correlation_id", "unknown")
        
        logger.warning(
            "posture.rejected",
            client_ip=client_ip,
            reason=reason,
            path=request.url.path,
            correlation_id=correlation_id,
        )

        # Log to Redis audit stream
        try:
            r = get_redis()
            event = {
                "timestamp": datetime.now(UTC).isoformat(),
                "action": "posture_rejected",
                "user_id": "unauthenticated",
                "email": "unknown",
                "roles": [],
                "method": request.method,
                "path": request.url.path,
                "status_code": 403,
                "client_ip": client_ip,
                "correlation_id": correlation_id,
                "duration_ms": 0.0,
                "detail": reason,
            }
            await r.xadd("audit:log", {"data": json.dumps(event)}, maxlen=10000)
        except Exception as exc:
            logger.error("posture.audit_log_failed", error=str(exc))

        return JSONResponse(
            status_code=403,
            content={
                "error": "device_posture_failed",
                "detail": reason,
                "correlation_id": correlation_id,
            },
        )
