"""Audit log — records every authenticated request for security compliance.

Emits structured audit events to:
1. Structured logs (always)
2. Redis stream `audit:log` (when Redis is available, for dashboard consumption)
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

import structlog

logger = structlog.get_logger()


async def emit_audit_event(
    *,
    action: str,
    user_id: str,
    email: str,
    roles: list[str],
    method: str,
    path: str,
    status_code: int,
    client_ip: str,
    correlation_id: str,
    duration_ms: float,
    extra: dict | None = None,
) -> None:
    """Emit an audit log event.

    Args:
        action: The action type (e.g., "request", "login", "logout", "revoke").
        user_id: Authenticated user's ID.
        email: User's email.
        roles: User's roles at time of request.
        method: HTTP method.
        path: Request path.
        status_code: Response status code.
        client_ip: Client IP address.
        correlation_id: Correlation ID for the request.
        duration_ms: Request duration in milliseconds.
        extra: Additional metadata.
    """
    event = {
        "timestamp": datetime.now(UTC).isoformat(),
        "action": action,
        "user_id": user_id,
        "email": email,
        "roles": roles,
        "method": method,
        "path": path,
        "status_code": status_code,
        "client_ip": client_ip,
        "correlation_id": correlation_id,
        "duration_ms": duration_ms,
    }
    if extra:
        event["extra"] = extra

    # Always emit to structured log
    logger.info("audit.event", **event)

    # Try to push to Redis stream (non-blocking, best-effort)
    try:
        from app.auth.sessions import get_redis

        r = get_redis()
        await r.xadd(
            "audit:log",
            {"data": json.dumps(event)},
            maxlen=10000,  # Keep last 10k events
        )
    except Exception:
        # Redis not available — that's fine, we have the structured log
        pass
