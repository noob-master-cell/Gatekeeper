# ──────────────────────────────────────────────────────────────
# Gatekeeper Benchmark Suite
# Compare Gatekeeper vs Caddy, Traefik, Nginx
# Uses k6 for load testing
# ──────────────────────────────────────────────────────────────

## Quick Start

```bash
# Install k6 (macOS)
brew install grafana/k6/k6

# Start the test environment
cd infra && docker compose up -d

# Run benchmarks
cd benchmarks
./run-all.sh
```

## What We Test

| Metric | Description |
|--------|-------------|
| p50/p95/p99 latency | Request latency at percentiles |
| RPS | Requests per second sustained |
| Memory | RSS during load |
| CPU | CPU usage during load |

## Scenarios

| Scenario | Concurrent | Duration | Payload |
|----------|-----------|----------|---------|
| Baseline | 100 | 60s | 1KB |
| Medium | 1000 | 60s | 100KB |
| Stress | 10000 | 30s | 1MB |
| Sustained | 500 | 300s | 1KB |
| Rate Limit Breach | ramp 0→500 | 45s | — |
| Auth Flow | 50 | 60s | — |

## k6 Scripts

| Script | Description | Usage |
|--------|-------------|-------|
| `k6/gatekeeper.js` | General throughput & latency benchmark (multiple scenarios via `SCENARIO` env var) | `k6 run k6/gatekeeper.js` |
| `k6/rate_limit_test.js` | Verifies token bucket fires 429s at the right rate | `k6 run k6/rate_limit_test.js` |
| `k6/auth_flow_test.js` | Full login → protected request cycle | `k6 run k6/auth_flow_test.js` |

### Rate Limit Breach Test

Ramps to 500 VUs over 10 s then hammers `/proxy/health` with no sleep, confirming that:

1. At least one 429 is returned (`rate_limited_responses count > 0`)
2. Even rejected requests resolve quickly (`p(95) < 500 ms`)
3. `X-RateLimit-Limit` / `X-RateLimit-Remaining` headers are present

```bash
k6 run benchmarks/k6/rate_limit_test.js
# Override target:
k6 run -e BASE_URL=https://gatekeeper.example.com benchmarks/k6/rate_limit_test.js
```

### Auth Flow Test

Simulates 50 concurrent users each performing:

1. `POST /auth/dev-login` — obtains a session cookie (requires `GK_DEV_MODE=true`)
2. `GET /admin/sessions` — hits a protected endpoint using the cookie

Thresholds: login p95 < 300 ms, protected p95 < 200 ms, auth failures < 10.

```bash
k6 run benchmarks/k6/auth_flow_test.js
# Override target:
k6 run -e BASE_URL=https://gatekeeper.example.com benchmarks/k6/auth_flow_test.js
```

---

## Algorithm: Token Bucket (Lua)

The original rate limiter used Redis `INCR` + `EXPIRE` — a **fixed-window counter**,
not a token bucket. Two problems:

1. **Boundary bursts**: A client can fire `N` requests just before a window resets and
   another `N` immediately after, yielding `2N` requests in a short interval — double
   the intended rate.

2. **Race condition**: `INCR` and `EXPIRE` are two separate commands. Under concurrent
   load a key can be incremented millions of times without ever getting an expiry,
   because another coroutine wins the `INCR` but the `EXPIRE` hasn't run yet (or
   Redis restarts between the two calls).

### The fix: atomic Lua `EVALSHA`

The token bucket state (`tokens`, `ts`) is stored in a Redis hash. On every request,
a Lua script loaded via `SCRIPT LOAD` is executed atomically with `EVALSHA`:

```
tokens ← min(capacity, tokens + elapsed_seconds × refill_rate)
if tokens >= 1:
    tokens -= 1  →  allowed
else:
    retry_ms = ceil((1 - tokens) / rate × 1000)  →  denied
HSET key tokens <new> ts <now_ms>
EXPIRE key <capacity/rate + 5>
return {allowed, floor(tokens), retry_ms}
```

Because Lua scripts run inside a single Redis command, no other client can observe
or modify the bucket between the read and the write.

**Time complexity**: O(1) per check — one `HMGET`, one `HSET`, one `EXPIRE`.

**Redis restart resilience**: If Redis is restarted the SHA cache is invalidated.
The middleware catches the `NOSCRIPT` error, reloads the script, and retries once —
transparent to callers.

---

## Resilience: Circuit Breaker

`gatekeeper-proxy/app/circuit_breaker.py` implements the classic 3-state machine
per upstream:

```
CLOSED ──(failures >= threshold)──► OPEN
  ▲                                    │
  │                             (recovery_timeout)
  │                                    ▼
  └──(probe succeeds)────────── HALF_OPEN
```

| State | Behaviour |
|-------|-----------|
| **CLOSED** | All requests flow through normally |
| **OPEN** | Requests fail-fast with HTTP 503 — upstream is not contacted |
| **HALF_OPEN** | One probe request is allowed; success closes, failure re-opens |

Two independent breakers exist:

- `backend_cb` — wraps requests to `settings.backend_url`
- `control_plane_cb` — wraps requests to `settings.control_plane_url` (`/admin/*`)

Configuration (defaults): `failure_threshold=5`, `recovery_timeout=30 s`.

Current state is visible at `GET /admin/circuit-breakers` and is also included
in the `GET /admin/status` response under the `circuit_breakers` key.

---

## Benchmark Results (localhost, Docker Compose, Apple M-series)

| Scenario | VUs | RPS | p50 | p95 | p99 |
|----------|-----|-----|-----|-----|-----|
| Baseline | 100 | 3,336 | 17 ms | 47 ms | — |
| Medium (projected) | 1,000 | ~2,800 | ~35 ms | ~180 ms | ~400 ms |
| Stress (projected) | 10,000 | ~1,200 | ~120 ms | ~600 ms | ~950 ms |
| Sustained (projected) | 500 | ~3,000 | ~25 ms | ~90 ms | ~200 ms |

> Baseline numbers are from `results/gatekeeper_baseline.json` (100 VUs, 60 s,
> mix of `/proxy/health`, `/api/hr/employees` (401), `/.well-known/jwks.json`).
> Medium/Stress/Sustained rows are projections — run `./run-all.sh` to populate
> real numbers.

---

## Honest Assessment

Gatekeeper is a Python (FastAPI + uvicorn) proxy. It will be **slower** than
Caddy (Go), Traefik (Go), and Nginx (C) in raw RPS benchmarks. This is expected.

The trade-off: Gatekeeper adds **per-request zero-trust enforcement** including
JWT verification, Redis session lookups, RBAC checks, OPA policy evaluation,
and audit logging. The overhead is the cost of security.

We measure this overhead explicitly so users can make informed decisions.
