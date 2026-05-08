# Benchmark Results

All benchmarks run locally against the `docker-compose` dev stack (no Kubernetes overhead).
Hardware: MacBook, Docker Desktop. Results are for orientation, not production capacity planning.

## Baseline — 100 VUs, 60s

| Metric | Gatekeeper Proxy | Direct Backend | Overhead |
|--------|-----------------|----------------|---------|
| p50 latency | 16.84ms | 6.61ms | +10.2ms |
| p90 latency | 38.83ms | 10.51ms | +28.3ms |
| p95 latency | 46.82ms | 14.99ms | +31.8ms |
| avg latency | 19.83ms | 6.79ms | +13ms |
| RPS | 3,336/s | 5,910/s | -44% |
| Error rate | 33% (expected 401s) | 0% | — |

### What the overhead buys you

Each proxied request through Gatekeeper adds ~13ms avg / ~32ms p95 compared to direct backend.
That overhead covers:
- JWT or API key verification
- Redis session lookup (revocation check)
- OPA policy evaluation (or cache hit — 30s TTL)
- Rate limit check in Redis
- Prometheus metrics recording
- Structured audit log write to Redis Stream
- W3C trace context injection to upstream

The 401 rate on the proxy benchmark is expected: the k6 script hits `/api/hr/employees` (auth required)
without providing a token. The custom check `status is 2xx or 401` passed 100%.

## Running Benchmarks

```bash
# Install k6
brew install k6

# Baseline (100 VUs, 60s)
k6 run --env SCENARIO=baseline benchmarks/k6/gatekeeper.js

# Medium (1000 VUs, 60s)
k6 run --env SCENARIO=medium benchmarks/k6/gatekeeper.js

# Direct backend comparison
k6 run benchmarks/k6/direct_backend.js
```

## Raw Results

- [`gatekeeper_baseline.json`](gatekeeper_baseline.json) — proxy with 100 VUs
- [`direct_baseline.json`](direct_baseline.json) — backend direct with 100 VUs
