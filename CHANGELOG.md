# Changelog

All notable changes to Gatekeeper are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [0.2.0] — 2025-05-09

### Added
- OPA (Open Policy Agent) integration with Rego policy engine, decision caching (30s TTL, 4096 entries), and configurable fail-open/fail-closed mode
- OpenTelemetry tracing with W3C trace-context propagation to upstreams, OTLP/gRPC export, FastAPI and httpx auto-instrumentation
- Structured JSON logging via structlog with correlation ID, trace ID, span ID, and user context on every log line
- Audit log stream backed by Redis Streams (`audit:log`) with 10,000-event cap and filterable API (`/admin/audit-logs`)
- Prometheus metrics: request counter, latency histogram (15 buckets, 5ms–30s), active connections gauge, upstream health gauge, auth event counter, rate limit hit counter, policy decision counter
- Grafana dashboard provisioning with pre-built dashboards in `infra/grafana/`
- OpenTelemetry Collector in docker-compose for OTLP ingestion and metric export
- Device posture middleware — blocks requests matching banned IPs or user-agent patterns
- CSRF middleware — validates `Origin` header on all state-changing requests
- Security headers middleware — sets `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy`, `Permissions-Policy` on every response
- Admin dashboard (React + TypeScript + Tailwind v4) with session management, API key management, and audit log viewer
- Production Docker Compose (`infra/docker-compose.prod.yml`) with Nginx load balancer and 3 proxy replicas
- Helm chart (`chart/`) with HPA, liveness/readiness probes, non-root security context, and read-only filesystem
- k6 benchmark suite (`benchmarks/`) with baseline, medium, and stress scenarios
- GitHub Actions CI: lint (ruff), test (pytest matrix), Docker build + push to GHCR, Trivy security scan on releases

### Changed
- CORS and CSRF allowed origins are now configurable via `GK_CORS_ORIGINS` / `GK_CSRF_ORIGINS` env vars instead of hardcoded
- Uvicorn now binds to `::` (IPv6) by default to support Railway internal networking

### Fixed
- Cookie persistence across Railway proxy hops by forwarding `X-Forwarded-Proto` to backend
- IPv6 binding for Railway internal service communication

---

## [0.1.0] — 2025-01-15

### Added
- Initial monorepo: `gatekeeper-proxy`, `gatekeeper-backend`, `gatekeeper-control-plane`, `gatekeeper-dashboard`
- Google OAuth 2.0 login flow with RS256 JWT issuance (HttpOnly cookie, SameSite=Lax)
- JWKS endpoint (`/.well-known/jwks.json`) with RSA-2048 key rotation (30-day default, grace period)
- Redis session store with instant revocation via JTI key deletion
- API key authentication: SHA-256 hashed storage, `gk_` prefix format, per-key roles and rate limits
- Optional mTLS for service-to-service communication (`GK_MTLS_ENABLED`)
- Role-based access control (RBAC) with role sync from Control Plane via Redis
- Token-bucket rate limiting per IP and per API key, with configurable tiers per endpoint sensitivity
- PostgreSQL-backed Control Plane with Alembic migrations for user, role, API key, and policy management
- Dev login mode (`GK_DEV_LOGIN_ENABLED`) for local development without Google OAuth
- Full docker-compose stack: proxy, backend, control-plane, Redis, PostgreSQL, OPA, Prometheus, Grafana, echo upstream, httpbin upstream
- Multi-stage Dockerfiles with non-root users and virtual environment isolation
- Makefile targets: `dev-up`, `dev-down`, `logs`, `test-all`, `lint`, `fmt`, `smoke`, `bench`
- Smoke test suite (`infra/smoke-tests.sh`)

[Unreleased]: https://github.com/dheerajkarwasra/zti/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/dheerajkarwasra/zti/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/dheerajkarwasra/zti/releases/tag/v0.1.0
