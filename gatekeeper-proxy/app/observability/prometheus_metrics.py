"""Prometheus metrics exporter — production-grade metrics for Gatekeeper proxy.

Exposes:
  - gatekeeper_requests_total (counter): Total requests by method, path, status, upstream
  - gatekeeper_request_duration_seconds (histogram): Latency with standard buckets
  - gatekeeper_request_size_bytes (histogram): Request body size
  - gatekeeper_response_size_bytes (histogram): Response body size
  - gatekeeper_active_connections (gauge): Currently in-flight requests
  - gatekeeper_upstream_health (gauge): Upstream health status (1=healthy, 0=unhealthy)
  - gatekeeper_auth_events_total (counter): Auth events by type (success, failure, revoked)
  - gatekeeper_rate_limit_hits_total (counter): Rate limit rejections
  - gatekeeper_policy_decisions_total (counter): OPA/RBAC policy decisions
"""

from __future__ import annotations

import time
from typing import Callable

from prometheus_client import (
    Counter,
    Gauge,
    Histogram,
    generate_latest,
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    REGISTRY,
)
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

# ─── Metric definitions ──────────────────────────────────────

# Standard latency buckets (in seconds): 5ms → 30s
LATENCY_BUCKETS = (
    0.005, 0.01, 0.025, 0.05, 0.075,
    0.1, 0.25, 0.5, 0.75,
    1.0, 2.5, 5.0, 7.5, 10.0, 30.0,
)

SIZE_BUCKETS = (
    100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000,
)

REQUEST_COUNT = Counter(
    "gatekeeper_requests_total",
    "Total HTTP requests processed",
    ["method", "path_template", "status_code", "upstream"],
)

REQUEST_DURATION = Histogram(
    "gatekeeper_request_duration_seconds",
    "Request latency in seconds",
    ["method", "path_template", "upstream"],
    buckets=LATENCY_BUCKETS,
)

REQUEST_SIZE = Histogram(
    "gatekeeper_request_size_bytes",
    "Request body size in bytes",
    ["method", "path_template"],
    buckets=SIZE_BUCKETS,
)

RESPONSE_SIZE = Histogram(
    "gatekeeper_response_size_bytes",
    "Response body size in bytes",
    ["method", "path_template"],
    buckets=SIZE_BUCKETS,
)

ACTIVE_CONNECTIONS = Gauge(
    "gatekeeper_active_connections",
    "Number of currently in-flight requests",
)

UPSTREAM_HEALTH = Gauge(
    "gatekeeper_upstream_health",
    "Upstream service health (1=healthy, 0=unhealthy)",
    ["upstream"],
)

AUTH_EVENTS = Counter(
    "gatekeeper_auth_events_total",
    "Authentication events by outcome",
    ["event_type"],  # success, token_expired, token_invalid, session_revoked, missing_token
)

RATE_LIMIT_HITS = Counter(
    "gatekeeper_rate_limit_hits_total",
    "Rate limit rejections",
    ["client_ip", "tier"],
)

POLICY_DECISIONS = Counter(
    "gatekeeper_policy_decisions_total",
    "Policy engine decisions",
    ["engine", "decision"],  # engine: rbac|opa, decision: allow|deny
)


# ─── Path normalization ──────────────────────────────────────

# Avoid high-cardinality labels by collapsing dynamic path segments
_PATH_GROUPS = [
    ("/api/hr/", "/api/hr/*"),
    ("/api/admin/", "/api/admin/*"),
    ("/admin/sessions/", "/admin/sessions/*"),
    ("/admin/audit-logs", "/admin/audit-logs"),
    ("/admin/policies/", "/admin/policies/*"),
    ("/admin/posture/", "/admin/posture/*"),
    ("/admin/metrics", "/admin/metrics"),
    ("/auth/", "/auth/*"),
    ("/oauth/", "/oauth/*"),
]


def _normalize_path(path: str) -> str:
    """Collapse dynamic path segments to prevent cardinality explosion."""
    for prefix, template in _PATH_GROUPS:
        if path.startswith(prefix) or path == prefix.rstrip("/"):
            return template
    # Skip static assets entirely
    if path.startswith(("/static/", "/assets/", "/vite.")):
        return "/static/*"
    return path


def _determine_upstream(path: str) -> str:
    """Determine which upstream a request is routed to."""
    if path.startswith("/admin/"):
        return "control-plane"
    if path.startswith("/api/"):
        return "backend"
    return "self"


# ─── Middleware ───────────────────────────────────────────────

# Paths to skip metrics entirely (self-referencing noise)
_SKIP_PATHS = frozenset({
    "/proxy/health", "/health", "/metrics",
    "/.well-known/jwks.json", "/favicon.ico",
})


class PrometheusMiddleware(BaseHTTPMiddleware):
    """Collects Prometheus metrics for every request."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        path = request.url.path

        if path in _SKIP_PATHS:
            return await call_next(request)

        method = request.method
        path_template = _normalize_path(path)
        upstream = _determine_upstream(path)

        # Track request body size
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                REQUEST_SIZE.labels(method=method, path_template=path_template).observe(
                    int(content_length)
                )
            except (ValueError, TypeError):
                pass

        ACTIVE_CONNECTIONS.inc()
        start = time.monotonic()

        try:
            response = await call_next(request)
            status_code = response.status_code
        except Exception:
            status_code = 500
            raise
        finally:
            duration = time.monotonic() - start
            ACTIVE_CONNECTIONS.dec()

            REQUEST_COUNT.labels(
                method=method,
                path_template=path_template,
                status_code=str(status_code),
                upstream=upstream,
            ).inc()

            REQUEST_DURATION.labels(
                method=method,
                path_template=path_template,
                upstream=upstream,
            ).observe(duration)

            # Track response size
            resp_size = response.headers.get("content-length")
            if resp_size:
                try:
                    RESPONSE_SIZE.labels(
                        method=method, path_template=path_template
                    ).observe(int(resp_size))
                except (ValueError, TypeError):
                    pass

        return response


# ─── Metrics endpoint handler ────────────────────────────────


def get_metrics_response() -> Response:
    """Generate Prometheus text-format metrics response."""
    body = generate_latest(REGISTRY)
    return Response(
        content=body,
        media_type=CONTENT_TYPE_LATEST,
    )
