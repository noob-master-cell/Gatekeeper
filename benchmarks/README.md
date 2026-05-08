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

## Honest Assessment

Gatekeeper is a Python (FastAPI + uvicorn) proxy. It will be **slower** than
Caddy (Go), Traefik (Go), and Nginx (C) in raw RPS benchmarks. This is expected.

The trade-off: Gatekeeper adds **per-request zero-trust enforcement** including
JWT verification, Redis session lookups, RBAC checks, OPA policy evaluation,
and audit logging. The overhead is the cost of security.

We measure this overhead explicitly so users can make informed decisions.
