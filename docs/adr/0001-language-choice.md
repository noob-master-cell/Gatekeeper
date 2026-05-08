# ADR-0001: Language and Framework Choice

## Status
Accepted

## Date
2025-01-15

## Context

Gatekeeper is a zero-trust reverse proxy handling authentication (OAuth2, JWT, API keys, mTLS),
authorization (RBAC + OPA), rate limiting, and observability (Prometheus, OpenTelemetry, structlog).

Key requirements drove the language evaluation:
- First-class async I/O (every request involves Redis lookups, JWT verification, and optional OPA queries)
- Rich ecosystem for auth, observability, and HTTP proxying
- Readable, maintainable code for a single developer iterating fast
- OpenTelemetry SDK, OPA client library, and Prometheus client availability

## Decision

**Python 3.11 + FastAPI + uvicorn**

FastAPI provides async-native request handling, automatic OpenAPI schema generation, and a middleware
stack that makes it straightforward to compose the 9-layer middleware pipeline in `gatekeeper-proxy/app/main.py`.
uvicorn runs the ASGI server. All I/O is async (httpx for upstream forwarding, redis.asyncio for sessions).

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| **Go + net/http or gin** | Excellent raw throughput, low memory, no GIL, natural fit for proxy work | Longer development time, less mature OPA client, weaker async primitives for middleware composition |
| **Rust + axum** | Best possible performance, memory safety, tiny binaries | Steep learning curve, slowest iteration speed, smallest ecosystem for auth/observability libraries |
| **Node.js + Express/Fastify** | Fast iteration, good async model | Dynamic typing at scale, weaker structlog/OPA ecosystem, GC pauses under load |
| **Python + FastAPI** | Fastest iteration, richest ecosystem (opentelemetry-sdk, opa-python-client, prometheus-client, structlog, PyJWT), async throughout | GIL limits single-process throughput; Python proxy will be slower than Go/Nginx at raw RPS |

## Consequences

### Positive
- The entire middleware stack (`SecurityHeaders → CORS → CorrelationId → Prometheus → Logging → RateLimit → CSRF → DevicePosture → Auth`) was composed in a single afternoon
- `opentelemetry-instrumentation-fastapi` and `opentelemetry-instrumentation-httpx` provide automatic span creation with zero boilerplate
- `structlog` with JSON rendering gives production-grade structured logging out of the box
- `opa-python-client` integrates cleanly with OPA's REST API
- Type hints + Pydantic models provide runtime validation at system boundaries

### Negative
- The GIL limits parallelism on CPU-bound operations; JWT verification and SHA-256 hashing are CPU-bound but fast enough in practice
- Python proxy overhead adds ~2–5ms compared to Go/Nginx for a simple pass-through — this is an acceptable trade-off given the security processing happening per request
- The benchmark headline for this project is "secure-by-default" and "zero-trust overhead measured", not "fastest proxy"

### Mitigation
- All I/O paths are async — Redis, OPA queries, upstream forwarding all use `async/await`
- uvicorn can run multiple worker processes (`--workers N`) for CPU-bound parallelism
- The proxy is stateless; horizontal scaling behind a load balancer is the primary scale-out strategy
- OPA decision cache (30s TTL, 4096 entries in `app/auth/opa.py`) eliminates repeated network calls for the same role/path combination

## References
- `gatekeeper-proxy/app/main.py` — middleware stack composition
- `gatekeeper-proxy/pyproject.toml` — full dependency list
- `benchmarks/k6/` — benchmark suite measuring actual overhead
