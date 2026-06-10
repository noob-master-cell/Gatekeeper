"""Open Policy Agent (OPA) integration — hot-reloadable policy decisions in Rego.

Architecture:
  - Gatekeeper sends authorization queries to an OPA sidecar/server via REST API
  - Policies are written in Rego and managed externally (OPA bundle server, git-sync, etc.)
  - Decisions are cached in-memory with configurable TTL
  - Falls back to RBAC if OPA is not configured or unreachable

OPA input document:
  {
    "input": {
      "method": "GET",
      "path": "/api/hr/employees",
      "user": {
        "id": "user-123",
        "email": "alice@company.com",
        "roles": ["admin", "hr"]
      },
      "client_ip": "203.0.113.42",
      "headers": {"user-agent": "..."},
      "timestamp": "2024-01-15T10:30:45Z"
    }
  }

OPA expected output:
  {
    "result": {
      "allow": true,
      "reason": "admin_role_granted"
    }
  }
"""

from __future__ import annotations

import time
from datetime import UTC, datetime

import httpx
import structlog

from app.config import settings

logger = structlog.get_logger()

# ─── Decision cache ──────────────────────────────────────────

_DECISION_CACHE: dict[str, tuple[bool, str, float]] = {}
_CACHE_TTL = 30.0  # seconds
_CACHE_MAX_SIZE = 4096


def _cache_key(path: str, method: str, roles: list[str]) -> str:
    return f"{method}:{path}:{','.join(sorted(roles))}"


def _cache_get(key: str) -> tuple[bool, str] | None:
    entry = _DECISION_CACHE.get(key)
    if entry is None:
        return None
    allowed, reason, expires_at = entry
    if time.monotonic() > expires_at:
        del _DECISION_CACHE[key]
        return None
    return allowed, reason


def _cache_set(key: str, allowed: bool, reason: str) -> None:
    if len(_DECISION_CACHE) >= _CACHE_MAX_SIZE:
        now = time.monotonic()
        expired = [k for k, v in _DECISION_CACHE.items() if v[2] < now]
        for k in expired:
            del _DECISION_CACHE[k]
        if len(_DECISION_CACHE) >= _CACHE_MAX_SIZE:
            to_evict = list(_DECISION_CACHE.keys())[:_CACHE_MAX_SIZE // 4]
            for k in to_evict:
                del _DECISION_CACHE[k]
    _DECISION_CACHE[key] = (allowed, reason, time.monotonic() + _CACHE_TTL)


# ─── OPA client ──────────────────────────────────────────────

_opa_client: httpx.AsyncClient | None = None


async def _get_opa_client() -> httpx.AsyncClient:
    """Get or create a shared httpx client for OPA queries."""
    global _opa_client
    if _opa_client is None or _opa_client.is_closed:
        _opa_client = httpx.AsyncClient(
            base_url=settings.opa_url,
            timeout=httpx.Timeout(connect=1.0, read=2.0, write=2.0, pool=1.0),
        )
    return _opa_client


async def close_opa_client() -> None:
    """Gracefully close the OPA client."""
    global _opa_client
    if _opa_client and not _opa_client.is_closed:
        await _opa_client.aclose()
        _opa_client = None


async def get_policy() -> str | None:
    """Fetch the current Rego policy from OPA."""
    try:
        client = await _get_opa_client()
        resp = await client.get("/v1/policies/gatekeeper_authz")
        if resp.status_code == 200:
            data = resp.json()
            return data.get("result", {}).get("raw", "")
        return None
    except Exception as exc:
        logger.error("opa.get_policy_error", error=str(exc))
        return None


async def push_policy(rego_text: str) -> tuple[bool, str]:
    """Push a new Rego policy to OPA and invalidate the decision cache."""
    try:
        client = await _get_opa_client()
        resp = await client.put(
            "/v1/policies/gatekeeper_authz",
            content=rego_text.encode(),
            headers={"Content-Type": "text/plain"},
        )
        if resp.status_code in (200, 201):
            invalidate_cache()
            logger.info("opa.policy_pushed", bytes=len(rego_text))
            return True, "policy_updated"
        return False, f"opa_error:{resp.status_code} {resp.text}"
    except Exception as exc:
        logger.error("opa.push_policy_error", error=str(exc))
        return False, str(exc)


async def evaluate_policy(
    *,
    method: str,
    path: str,
    user_id: str,
    email: str,
    roles: list[str],
    client_ip: str,
    headers: dict[str, str] | None = None,
) -> tuple[bool, str]:
    """Evaluate an authorization decision against OPA.

    Args:
        method: HTTP method (GET, POST, etc.)
        path: Request path
        user_id: Authenticated user ID
        email: User email
        roles: User roles
        client_ip: Client IP address
        headers: Optional request headers to include in policy input

    Returns:
        Tuple of (allowed: bool, reason: str)
    """
    if not settings.opa_enabled:
        return True, "opa_disabled"

    # Check cache
    key = _cache_key(path, method, roles)
    cached = _cache_get(key)
    if cached is not None:
        return cached

    # Build OPA input document
    opa_input = {
        "input": {
            "method": method,
            "path": path,
            "path_parts": [p for p in path.split("/") if p],
            "user": {
                "id": user_id,
                "email": email,
                "roles": roles,
            },
            "client_ip": client_ip,
            "timestamp": datetime.now(UTC).isoformat(),
        }
    }

    if headers:
        # Only include safe headers (no auth tokens)
        safe_headers = {
            k: v for k, v in headers.items()
            if k.lower() not in ("authorization", "cookie", "x-api-key")
        }
        opa_input["input"]["headers"] = safe_headers

    try:
        client = await _get_opa_client()
        policy_path = settings.opa_policy_path  # e.g., "v1/data/gatekeeper/authz"

        response = await client.post(
            f"/{policy_path}",
            json=opa_input,
        )

        if response.status_code != 200:
            logger.error(
                "opa.query_failed",
                status_code=response.status_code,
                body=response.text[:200],
            )
            # Fail closed: deny if OPA returns an error
            return _handle_opa_failure("opa_error")

        result = response.json().get("result", {})
        allowed = result.get("allow", False)
        reason = result.get("reason", "opa_decision")

        # Track metrics
        try:
            from app.observability.prometheus_metrics import POLICY_DECISIONS
            POLICY_DECISIONS.labels(
                engine="opa",
                decision="allow" if allowed else "deny",
            ).inc()
        except Exception:
            pass

        # Cache the decision
        _cache_set(key, allowed, reason)

        logger.info(
            "opa.decision",
            allowed=allowed,
            reason=reason,
            path=path,
            method=method,
            email=email,
        )

        return allowed, reason

    except httpx.ConnectError:
        logger.error("opa.unreachable", url=settings.opa_url)
        return _handle_opa_failure("opa_unreachable")
    except httpx.TimeoutException:
        logger.error("opa.timeout", url=settings.opa_url)
        return _handle_opa_failure("opa_timeout")
    except Exception as exc:
        logger.error("opa.error", error=str(exc))
        return _handle_opa_failure("opa_error")


def _handle_opa_failure(reason: str) -> tuple[bool, str]:
    """Handle OPA failures based on configured fail mode."""
    if settings.opa_fail_open:
        logger.warning("opa.fail_open", reason=reason)
        return True, f"opa_fail_open:{reason}"
    else:
        logger.warning("opa.fail_closed", reason=reason)
        return False, f"opa_fail_closed:{reason}"


def invalidate_cache() -> None:
    """Clear the OPA decision cache (called when policies are reloaded)."""
    _DECISION_CACHE.clear()
    logger.info("opa.cache_invalidated")
