"""Background worker that syncs audit log entries from Redis stream to PostgreSQL.

Runs as an asyncio task inside the control plane lifespan. Reads from
the ``audit:log`` Redis stream using a consumer group so that multiple
control-plane replicas can safely share the work.
"""

from __future__ import annotations

import asyncio
import json

import redis.asyncio as aioredis
import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog

logger = structlog.get_logger()

STREAM_KEY = "audit:log"
GROUP_NAME = "audit_sync"
CONSUMER_NAME = "cp-worker"
BATCH_SIZE = 50
POLL_INTERVAL = 5  # seconds


async def ensure_consumer_group(r: aioredis.Redis) -> None:
    """Create the consumer group if it doesn't exist."""
    try:
        await r.xgroup_create(STREAM_KEY, GROUP_NAME, id="0", mkstream=True)
        logger.info("audit_sync.group_created", stream=STREAM_KEY, group=GROUP_NAME)
    except aioredis.ResponseError as e:
        if "BUSYGROUP" in str(e):
            pass  # Already exists
        else:
            raise


async def sync_audit_logs(
    session_factory,
    r: aioredis.Redis,
) -> None:
    """Continuously consume the audit:log stream and persist to Postgres.

    Args:
        session_factory: An async session factory (``async_session``).
        r: An initialised async Redis client.
    """
    await ensure_consumer_group(r)

    while True:
        try:
            # Read new messages from the consumer group
            entries = await r.xreadgroup(
                GROUP_NAME,
                CONSUMER_NAME,
                {STREAM_KEY: ">"},
                count=BATCH_SIZE,
                block=POLL_INTERVAL * 1000,
            )

            if not entries:
                continue

            for _stream, messages in entries:
                async with session_factory() as session:
                    for msg_id, fields in messages:
                        await _persist_entry(session, msg_id, fields)
                    await session.commit()

                    # ACK all persisted messages
                    ids = [msg_id for msg_id, _ in messages]
                    if ids:
                        await r.xack(STREAM_KEY, GROUP_NAME, *ids)

                    logger.debug("audit_sync.batch_persisted", count=len(messages))

        except asyncio.CancelledError:
            logger.info("audit_sync.cancelled")
            break
        except Exception as exc:
            logger.warning("audit_sync.error", error=str(exc))
            await asyncio.sleep(POLL_INTERVAL)


async def _persist_entry(
    session: AsyncSession, stream_id: str, fields: dict
) -> None:
    """Parse a single Redis stream entry and write an AuditLog row."""
    try:
        data = json.loads(fields.get("data", "{}"))
    except (json.JSONDecodeError, TypeError):
        data = {}

    from datetime import datetime, UTC

    ts_raw = data.get("timestamp")
    ts = None
    if ts_raw:
        try:
            ts = datetime.fromisoformat(ts_raw)
        except (ValueError, TypeError):
            ts = datetime.now(UTC)
    else:
        ts = datetime.now(UTC)

    entry = AuditLog(
        stream_id=stream_id,
        timestamp=ts,
        action=data.get("action", "unknown"),
        user_email=data.get("email") or data.get("user_email"),
        user_id=data.get("user_id"),
        method=data.get("method"),
        path=data.get("path"),
        status_code=data.get("status_code"),
        client_ip=data.get("client_ip"),
        correlation_id=data.get("correlation_id"),
        detail=json.dumps(data) if data else None,
    )
    session.add(entry)
