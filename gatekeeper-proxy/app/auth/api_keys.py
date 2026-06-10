"""API key authentication — lightweight auth for service-to-service and CLI access.

API keys are stored in Redis with metadata:
  apikey:{hash} → JSON { name, owner, roles, created_at, last_used, rate_limit }

Keys are hashed with SHA-256 before storage (never stored in plaintext).
Supports:
  - Key creation/revocation via admin API
  - Per-key role assignment
  - Per-key rate limiting
  - Usage tracking (last_used timestamp)
"""

from __future__ import annotations

import hashlib
import json
import secrets
from datetime import UTC, datetime
from typing import Any

import structlog

from app.auth.sessions import get_redis

logger = structlog.get_logger()

# ─── Key format ──────────────────────────────────────────────
# API keys are formatted as: gk_<32 random hex chars>
# Example: gk_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4

API_KEY_PREFIX = "gk_"
API_KEY_HEADER = "X-API-Key"


def _hash_key(raw_key: str) -> str:
    """Hash an API key with SHA-256 for storage."""
    return hashlib.sha256(raw_key.encode()).hexdigest()


def generate_api_key() -> str:
    """Generate a new random API key."""
    return f"{API_KEY_PREFIX}{secrets.token_hex(32)}"


# ─── Key CRUD ────────────────────────────────────────────────


async def create_api_key(
    name: str,
    owner: str,
    roles: list[str],
    rate_limit: int = 1000,
    ttl_days: int = 365,
) -> dict[str, Any]:
    """Create a new API key and store it in Redis.

    Args:
        name: Human-readable name for the key (e.g., "CI Pipeline")
        owner: Owner email or service name
        roles: Roles granted to this key
        rate_limit: Requests per minute allowed
        ttl_days: Key validity in days (default 365)

    Returns:
        Dict with key metadata including the raw key (only shown once)
    """
    r = get_redis()
    raw_key = generate_api_key()
    key_hash = _hash_key(raw_key)

    metadata = {
        "name": name,
        "owner": owner,
        "roles": roles,
        "rate_limit": rate_limit,
        "created_at": datetime.now(UTC).isoformat(),
        "last_used": None,
        "key_prefix": raw_key[:12] + "...",  # Store prefix for identification
    }

    ttl_seconds = ttl_days * 86400
    await r.setex(f"apikey:{key_hash}", ttl_seconds, json.dumps(metadata))

    # Track key under owner for listing
    await r.sadd(f"apikeys:owner:{owner}", key_hash)
    await r.expire(f"apikeys:owner:{owner}", ttl_seconds)

    logger.info("apikey.created", name=name, owner=owner, roles=roles)

    return {
        "key": raw_key,  # Only returned once!
        "key_hash": key_hash,
        **metadata,
    }


async def validate_api_key(raw_key: str) -> dict[str, Any] | None:
    """Validate an API key and return its metadata.

    Args:
        raw_key: The raw API key from the request header

    Returns:
        Key metadata dict if valid, None if invalid/expired
    """
    if not raw_key.startswith(API_KEY_PREFIX):
        return None

    r = get_redis()
    key_hash = _hash_key(raw_key)
    data = await r.get(f"apikey:{key_hash}")

    if not data:
        return None

    metadata = json.loads(data)

    # Update last_used timestamp (fire-and-forget)
    try:
        metadata["last_used"] = datetime.now(UTC).isoformat()
        ttl = await r.ttl(f"apikey:{key_hash}")
        if ttl > 0:
            await r.setex(f"apikey:{key_hash}", ttl, json.dumps(metadata))
    except Exception:
        pass

    # Track metrics
    try:
        from app.observability.prometheus_metrics import AUTH_EVENTS

        AUTH_EVENTS.labels(event_type="apikey_success").inc()
    except Exception:
        pass

    logger.info("apikey.validated", name=metadata.get("name"), owner=metadata.get("owner"))
    return metadata


async def revoke_api_key(key_hash: str) -> bool:
    """Revoke an API key by its hash.

    Returns:
        True if the key existed and was revoked
    """
    r = get_redis()
    deleted = await r.delete(f"apikey:{key_hash}")
    if deleted:
        logger.info("apikey.revoked", key_hash=key_hash[:16])
    return deleted > 0


async def list_api_keys(owner: str | None = None) -> list[dict[str, Any]]:
    """List all API keys, optionally filtered by owner.

    Returns:
        List of key metadata dicts (without the raw key)
    """
    r = get_redis()
    keys = []

    if owner:
        key_hashes = await r.smembers(f"apikeys:owner:{owner}")
        for key_hash in key_hashes:
            data = await r.get(f"apikey:{key_hash}")
            if data:
                metadata = json.loads(data)
                metadata["key_hash"] = key_hash
                keys.append(metadata)
    else:
        # Scan for all API keys
        async for redis_key in r.scan_iter(match="apikey:*", count=100):
            # Skip owner index keys
            if ":owner:" in redis_key:
                continue
            key_hash = redis_key.replace("apikey:", "")
            data = await r.get(redis_key)
            if data:
                metadata = json.loads(data)
                metadata["key_hash"] = key_hash
                keys.append(metadata)

    return keys
