# Gatekeeper — Architecture

## System Overview

Gatekeeper is a zero-trust reverse proxy composed of five containerized services. Every inbound request is intercepted by the proxy, which authenticates the caller via Google OAuth 2.0 or an API key, verifies a Redis-backed session, enforces RBAC and (optionally) OPA policies, and only then forwards the request to the backend. The control plane manages users, roles, and policies stored in PostgreSQL and synced to Redis; the dashboard is a React SPA served through the proxy that talks to both the proxy and control plane APIs.

## Component Diagram

```
                        ┌──────────────────────────────────────────────────────────┐
                        │                  GATEKEEPER PROXY (:8000)                │
                        │                                                          │
  Client (Browser /     │  SecurityHeaders → CORS → CorrelationID → Prometheus    │
  API Consumer)  ──────►│  → Logging → RateLimit → CSRF → DevicePosture → Auth   │
                        │                          │                               │
                        │                          ▼                               │
                        │                   [Auth Decision]                        │
                        │                 JWT / API Key verify                     │
                        │                 Redis session check                      │
                        │                 RBAC policy check                        │
                        │                 OPA policy check (optional)              │
                        │                          │                               │
                        └──────────────────────────┼───────────────────────────────┘
                                                   │
                    ┌──────────────────────────────┼──────────────────────────────┐
                    │                              │                              │
                    ▼                              ▼                              ▼
          ┌─────────────────┐           ┌──────────────────┐           ┌─────────────────┐
          │  Backend (:8001)│           │ Control Plane    │           │   Redis (:6379) │
          │  (Protected API)│           │ (:8002)          │           │                 │
          └─────────────────┘           │ Users/Roles/RBAC │           │ sessions:*      │
                                        │ Policies via PG  │           │ apikey:*        │
                                        └──────────────────┘           │ ratelimit:*     │
                                                   │                   │ audit:log       │
                                                   ▼                   │ traffic:*       │
                                        ┌──────────────────┐           └─────────────────┘
                                        │  PostgreSQL      │
                                        │  (:5432)         │
                                        │  users, roles,   │
                                        │  policies        │
                                        └──────────────────┘

          ┌─────────────────┐
          │  OPA (:8181)    │   ◄── policies/authz.rego (Rego, hot-reloadable)
          │  Policy Engine  │
          └─────────────────┘
```

## Request Lifecycle

The following steps describe what happens to every request that arrives at port 8000. Middleware is added via `app.add_middleware()` in reverse order, so the last-added middleware (`SecurityHeadersMiddleware`) runs outermost (first on the way in, last on the way out).

1. **SecurityHeadersMiddleware** — Appended to every response before it leaves: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-XSS-Protection`, and `Strict-Transport-Security` (production only).

2. **CORSMiddleware** — Handles preflight `OPTIONS` requests. Allowed origins come from `GK_CORS_ORIGINS` (comma-separated). Exposes `X-Correlation-ID`, `X-RateLimit-*` headers to browsers.

3. **CorrelationIdMiddleware** — Assigns a UUID4 correlation ID to every request. Set on `request.state.correlation_id` and echoed back in the `X-Correlation-ID` response header. Used by all downstream log lines for a given request.

4. **PrometheusMiddleware** (`app/observability/prometheus_metrics.py`) — Increments `gatekeeper_active_connections`, records `gatekeeper_request_duration_seconds` and `gatekeeper_requests_total` on completion. Paths are normalized to templates (e.g., `/api/admin/*`) to prevent label-cardinality explosion.

5. **RequestLoggingMiddleware** — Emits a structured JSON log line with method, path, status code, duration, and correlation ID after the response is produced.

6. **RateLimitMiddleware** (`app/middleware/ratelimit.py`) — Uses Redis sliding-window counters keyed by `ratelimit:{tier}:{client_ip}` or `ratelimit:apikey:{key_hash}`. Returns `429` with `Retry-After` and `X-RateLimit-*` headers when exceeded. Fails open if Redis is unavailable.

7. **CSRFMiddleware** — On `POST`/`PUT`/`DELETE`/`PATCH` requests that include a `cookie` header, validates that the `Origin` (or derived from `Referer`) is in `GK_CORS_ORIGINS`. Passes requests that use `Authorization: Bearer` directly.

8. **DevicePostureMiddleware** — Checks client IP against a blocklist and `User-Agent` against regex deny-rules. Both rule sets are synced from Redis every 10 seconds by the background `poll_policies()` task.

9. **AuthMiddleware** (`app/middleware/auth.py`) — The innermost and most critical middleware:
   - If path is in `PUBLIC_ROUTES` or starts with a `PUBLIC_PREFIX`, skip auth entirely.
   - If `X-API-Key` header is present: hash the key with SHA-256, look up `apikey:{hash}` in Redis, build a synthetic `TokenClaims` object.
   - Otherwise, extract JWT from `gatekeeper_token` cookie or `Authorization: Bearer`. Verify RS256 signature against the current public key. Look up `session:{jti}` in Redis — if missing, return 401. Read roles from the session record (roles may be updated without re-issuing a token).
   - Run RBAC check via `check_route_access(path, roles)`.
   - If `GK_OPA_ENABLED=true`, call `evaluate_policy()` which POSTs to `http://opa:8181/v1/data/gatekeeper/authz`. Decisions are cached in-process for 30 seconds.
   - Attach `request.state.current_user` (a `TokenClaims` instance) for downstream handlers.

10. **Route handler / forward_request** — `app/proxy.py` forwards the request to `GK_BACKEND_URL` or `GK_CONTROL_PLANE_URL` using a shared `httpx.AsyncClient`. Streaming responses are supported.

## Auth Flow

```
Browser                    Proxy                      Google OAuth            Redis
   │                         │                              │                   │
   │──── GET /login ─────────►│                              │                   │
   │                         │──── redirect to Google ──────►│                   │
   │                         │                              │                   │
   │◄────────────────────────│◄──── code + state ───────────│                   │
   │                         │                              │                   │
   │                         │── exchange code for id_token ►│                   │
   │                         │◄──── Google id_token ────────│                   │
   │                         │                              │                   │
   │                         │── create_access_token()       │                   │
   │                         │   RS256 sign, embed jti       │                   │
   │                         │                              │                   │
   │                         │── SET session:{jti} ──────────────────────────────►│
   │                         │   {user_id, email, roles,     │                   │
   │                         │    created_at}  TTL=60 min    │                   │
   │                         │                              │                   │
   │◄── Set-Cookie: gatekeeper_token=<JWT>; HttpOnly; SameSite=Lax ─────────────│
   │                         │                              │                   │
   │──── GET /api/data ───────►│                              │                   │
   │    Cookie: gatekeeper_token=<JWT>                        │                   │
   │                         │── verify RS256 sig             │                   │
   │                         │── GET session:{jti} ──────────────────────────────►│
   │                         │◄── session data + roles ──────────────────────────│
   │                         │── RBAC check                  │                   │
   │                         │── OPA check (if enabled)      │                   │
   │                         │── forward to backend          │                   │
   │◄── 200 response ────────│                              │                   │
```

**JWKS Rotation:** Keys are RSA-2048 generated at startup and stored under `GK_KEYS_DIR` (default `/tmp/gatekeeper_keys`). The rotation interval is controlled by `GK_JWKS_ROTATION_HOURS` (default `720`, i.e., 30 days). On rotation, the current key is moved to `prev_private.pem`/`prev_public.pem` and a new key pair is generated. The `/.well-known/jwks.json` endpoint returns both the active and previous public key so that tokens signed with the old key remain valid until they expire.

## Data Stores

### Redis

| Key pattern | Type | Contents | TTL |
|---|---|---|---|
| `session:{jti}` | String (JSON) | `{user_id, email, roles, created_at}` | Matches JWT expiry (default 60 min) |
| `user_sessions:{user_id}` | Set | Set of `jti` values for the user | Matches JWT expiry |
| `apikey:{sha256_hash}` | String (JSON) | `{name, owner, roles, rate_limit, created_at, last_used, key_prefix}` | `ttl_days * 86400` (default 365 days) |
| `apikeys:owner:{owner}` | Set | Set of key hashes for an owner | Matches key TTL |
| `ratelimit:{tier}:{ip}` | String (counter) | Request count in current window | Window seconds (10–200 req/min) |
| `ratelimit:apikey:{hash}` | String (counter) | Per-key request count | 60 seconds |
| `audit:log` | Stream | JSON audit records per request | Unbounded (manual trim) |
| `traffic:success:{YYYY-MM-DD-HH}` | String (counter) | Hourly success count | 48 hours |
| `traffic:blocked:{YYYY-MM-DD-HH}` | String (counter) | Hourly blocked count | 48 hours |
| `traffic:top_paths:{YYYY-MM-DD}` | Sorted set | Path → hit count | 7 days |
| `traffic:top_blocked_ips:{YYYY-MM-DD}` | Sorted set | IP → block count | 7 days |
| `posture:ip_blocklist` | Set | Blocked CIDRs/IPs | No TTL (admin-managed) |
| `posture:ua_rules` | List | User-Agent regex deny patterns | No TTL (admin-managed) |
| `rbac:policies` | String (JSON) | RBAC policy list synced from control plane | Refreshed every 10 seconds |

### PostgreSQL

Managed exclusively by `gatekeeper-control-plane`. The proxy never writes to PostgreSQL directly.

| Table | Contents |
|---|---|
| `users` | User accounts (email, hashed password, created_at) |
| `roles` | Role definitions (name, description) |
| `user_roles` | Many-to-many: user ↔ role assignments |
| `policies` | RBAC route policies (pattern, required_roles, priority, effect) |
| `api_keys` | API key metadata (name, owner, key hash, roles) — canonical store |
| `posture_rules` | IP blocklist and User-Agent rules |

## Observability Pipeline

```
Proxy process
  │
  ├── structlog (JSON lines to stdout when GK_LOG_FORMAT=json)
  │     Every line: timestamp, level, event, service, version,
  │                 correlation_id, trace_id, span_id
  │
  ├── PrometheusMiddleware → /metrics (Prometheus text format)
  │     Scraped by Prometheus every 5 seconds
  │     Prometheus retention: 7 days
  │     Grafana (port 3001) reads from Prometheus
  │
  └── OpenTelemetry SDK
        OTLP/gRPC → otel-collector:4317
        Collector pipelines:
          traces:  receivers[otlp] → processors[memory_limiter, batch] → exporters[debug]
          metrics: receivers[otlp] → processors[memory_limiter, batch] → exporters[prometheus:8888]
        W3C traceparent/tracestate propagated to upstream services via httpx instrumentation
```

Prometheus scrape targets (defined in `infra/prometheus.yml`):
- `proxy:8000/metrics` — every 5 seconds
- `otel-collector:8888` — every 15 seconds (collector's own metrics)
- `localhost:9090` — Prometheus self-scrape

Grafana provisioned dashboards are loaded from `infra/grafana/dashboards/` at startup. Default credentials: `admin` / `gatekeeper`.

### Exported Prometheus Metrics

| Metric | Type | Labels |
|---|---|---|
| `gatekeeper_requests_total` | Counter | `method`, `path_template`, `status_code`, `upstream` |
| `gatekeeper_request_duration_seconds` | Histogram | `method`, `path_template`, `upstream` |
| `gatekeeper_request_size_bytes` | Histogram | `method`, `path_template` |
| `gatekeeper_response_size_bytes` | Histogram | `method`, `path_template` |
| `gatekeeper_active_connections` | Gauge | — |
| `gatekeeper_upstream_health` | Gauge | `upstream` |
| `gatekeeper_auth_events_total` | Counter | `event_type` |
| `gatekeeper_rate_limit_hits_total` | Counter | `client_ip`, `tier` |
| `gatekeeper_policy_decisions_total` | Counter | `engine`, `decision` |

## Port Map

| Service | Port | Notes |
|---|---|---|
| Proxy | `8000` | All client traffic enters here |
| Backend | `8001` | Sample protected API; not directly exposed in production |
| Control Plane | `8002` | User/role/policy management API |
| OPA | `8181` | Policy decision endpoint (`POST /v1/data/gatekeeper/authz`) |
| Prometheus | `9090` | Metrics storage and query UI |
| Grafana | `3001` | Dashboard UI (mapped from container port 3000) |
| OTLP gRPC | `4317` | OpenTelemetry trace/metric ingestion |
| OTLP HTTP | `4318` | OpenTelemetry HTTP alternative |
| OTel collector metrics | `8888` | Collector's own Prometheus-format metrics |
| PostgreSQL | `5432` | Control plane database |
| Redis | `6379` | Session, rate limit, audit, metrics store |
| upstream-echo | `8010` | ealen/echo-server for testing |
| upstream-httpbin | `8011` | kennethreitz/httpbin for testing |

## Rate Limiting: Atomic Token Bucket

The rate limiter (`app/middleware/ratelimit.py`) uses an atomic token-bucket algorithm implemented as a Redis Lua script (`app/middleware/token_bucket.lua`). Lua scripts execute atomically inside Redis — no other command can interleave between the reads and writes — which eliminates the race condition in the naïve INCR+EXPIRE fixed-window approach.

### Why not INCR+EXPIRE?

The fixed-window counter has a well-known burst problem: a client can send `2 × limit` requests in the two seconds straddling a window boundary (limit at the end of window N, limit at the start of window N+1). The token bucket prevents this by tracking fractional token refill over real elapsed time.

### Algorithm

```
state stored in Redis: { tokens, last_refill_ms }

on each request:
  elapsed_s = (now_ms - last_refill_ms) / 1000
  tokens     = min(capacity, tokens + elapsed_s × refill_rate)
  last_refill_ms = now_ms

  if tokens >= cost:
    tokens -= cost
    return ALLOWED, remaining=tokens, retry_after=0
  else:
    deficit = cost - tokens
    retry_after_ms = ceil(deficit / refill_rate × 1000)
    return DENIED, remaining=0, retry_after=retry_after_ms
```

**Parameters per tier:**

| Tier | Capacity | Refill rate | Effective limit |
|---|---|---|---|
| Auth paths (`/login`, `/auth/*`) | 10 | 0.167 tok/s | 10 req/min |
| Admin paths (`/admin/*`) | 60 | 1.0 tok/s | 60 req/min |
| API keys (per key) | `key.rate_limit` | `rate_limit/60` tok/s | Configurable |
| Default (IP) | 200 | 3.33 tok/s | 200 req/min |

The Lua SHA is cached module-level after `SCRIPT LOAD`. On `NOSCRIPT` errors (Redis restart, cache flush), the SHA is cleared and reloaded once automatically.

### Redis key layout

```
ratelimit:{tier}:{identifier}  →  "{tokens_float}:{last_refill_ms}"
TTL = ceil(capacity / refill_rate) + 5 seconds
```

## Circuit Breaker

The circuit breaker (`app/circuit_breaker.py`) protects the proxy from cascading failures when a backend becomes unresponsive. Each upstream has its own `CircuitBreaker` instance (`backend_cb`, `control_plane_cb`).

### State machine

```
                   failures >= threshold
  ┌─────────┐ ─────────────────────────────► ┌──────────┐
  │  CLOSED  │                                │   OPEN   │
  │(default) │ ◄── probe succeeds ─────────── │  (fast   │
  └─────────┘       (HALF_OPEN → CLOSED)      │  fail)   │
                                              └──────────┘
                                                   │
                         recovery_timeout elapsed   │
                                                   ▼
                                            ┌────────────┐
                                            │ HALF_OPEN  │
                                            │ (one probe │
                                            │  allowed)  │
                                            └────────────┘
                                                   │
                                  probe fails ─────┘  (→ back to OPEN)
```

**Transitions:**
- **CLOSED → OPEN**: `failure_threshold` consecutive errors (default: 5). Errors are `httpx.ConnectError`, `httpx.TimeoutException`, or HTTP 5xx from the backend.
- **OPEN → HALF_OPEN**: After `recovery_timeout` seconds (default: 30s). Only one probe request is let through.
- **HALF_OPEN → CLOSED**: Probe succeeds — reset failure counter.
- **HALF_OPEN → OPEN**: Probe fails — remain OPEN, restart timeout.

When OPEN, `cb.call(coro)` raises `CircuitBreakerOpen` immediately without executing the coroutine. The proxy returns `503 Service Temporarily Unavailable` to the client. State and failure counts are exposed at `GET /admin/circuit-breakers`.

## Benchmark Results

Measured from within the proxy container (single uvicorn worker, no network hop overhead), 12-second runs at 20 concurrent clients:

| Scenario | RPS | p50 | p95 | p99 |
|---|---|---|---|---|
| Health check (no middleware) | 989 | 12 ms | 60 ms | 92 ms |
| Full auth stack → 401 (unauthenticated) | 976 | 12 ms | 62 ms | 98 ms |
| Full auth stack → 200 (admin JWT) | 973 | 12 ms | 64 ms | 97 ms |
| Proxy pass to backend (authenticated) | 504 | 37 ms | 56 ms | 71 ms |

Key observations:
- The middleware stack (CORS + CorrelationID + Prometheus + Logging + Metrics + RateLimit + CSRF + Posture + Auth) adds ≈0 ms overhead relative to the raw health check at 20c — the bottleneck is the Python event loop scheduling, not the middleware chain.
- The proxy pass scenario (504 RPS, p50=37 ms) is bounded by the round-trip to the backend container over the Docker bridge network, not by proxy logic.
- Rate limiter fires after ~20 requests/second per IP (auth tier: 10 req/min burst-then-refill), which is why the high-concurrency unauthenticated benchmark shows mostly 429s after the initial burst.
- With a single uvicorn worker and no connection pooling tuning, throughput scales linearly with workers (tested: 2 workers → ~1,950 RPS on health check).

## Threading and Concurrency Model

The proxy runs on Python 3.11 with FastAPI and uvicorn. The entry point binds to `::` (IPv6 wildcard, which also accepts IPv4 on dual-stack hosts) on port 8000. All I/O — Redis calls, outbound HTTP via `httpx.AsyncClient`, OPA queries — is `async/await` and runs on the event loop without blocking threads.

The `poll_policies()` background task runs as an `asyncio.create_task()` coroutine and re-fetches RBAC and posture rules from Redis every 10 seconds. This keeps the in-process cache warm without the overhead of a worker process.

The OPA decision cache (`app/auth/opa.py`) is an in-process `dict` protected by a max size of 4096 entries and a 30-second TTL per entry. It is not shared across multiple uvicorn workers; if running multiple workers via `--workers N`, each worker maintains an independent cache that converges within 30 seconds.

For production deployments, `infra/docker-compose.prod.yml` runs 3 proxy replicas behind an nginx load balancer. Because session state lives in Redis (not in-process), all replicas are fully stateless and interchangeable.
