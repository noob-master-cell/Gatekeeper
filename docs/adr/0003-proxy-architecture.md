# ADR-0003: Proxy Architecture Pattern

## Status
Accepted

## Date
2025-01-15

## Context

A reverse proxy with zero-trust capabilities can be deployed in three common patterns:

1. **Sidecar** — one proxy instance per application pod, intercepts all traffic at the pod level (service mesh model)
2. **Ingress controller** — a single Kubernetes-native gateway managing all cluster ingress
3. **Standalone reverse proxy** — a dedicated proxy service that upstreams route through, independent of the deployment platform

The project needs to work in development (Docker Compose on a laptop), staging (Railway), and
production (Kubernetes), without requiring Kubernetes to be operational to test the core behavior.

## Decision

**Standalone reverse proxy** as the primary deployment pattern, with a Helm chart (`chart/`) enabling
Kubernetes ingress-controller mode as an optional deployment target.

OPA is deployed as a **sidecar to the proxy** (not embedded), running as a separate container that
the proxy queries via REST API on `http://opa:8181`.

## Alternatives Considered

| Pattern | Pros | Cons |
|---------|------|------|
| **Sidecar (service mesh)** | Fine-grained per-service policies, compatible with Istio/Linkerd, transparent to apps | High resource overhead (one proxy per pod), complex configuration, requires Kubernetes, hard to test locally |
| **Ingress controller** | Kubernetes-native, single entry point, standard annotations model | Kubernetes-only, requires operator expertise, CRD-heavy, couples the project to K8s APIs |
| **Standalone (chosen)** | Platform-agnostic (works on Docker Compose, Railway, VMs, K8s), simple ops model, single binary to reason about, easy local testing | Single choke point (mitigated by HPA), not transparent to applications |

## Why OPA as a Sidecar (Not Embedded)

Embedding OPA's Rego interpreter directly into the proxy would:
- Require a restart to update policies (because the binary would need to reload the embedded engine)
- Couple policy versioning to application versioning
- Prevent sharing the OPA instance across multiple proxy replicas

Running OPA as a separate container means:
- Policies can be updated by modifying files in `policies/` without restarting the proxy
- The OPA decision cache in `app/auth/opa.py` (30s TTL, 4096 entries) absorbs the network overhead of the sidecar call
- OPA can be scaled or replaced independently
- The proxy fails open or closed (configurable via `GK_OPA_FAIL_OPEN`) if OPA is temporarily unavailable

## Proxy Statefulness

The proxy is deliberately **stateless** at the process level:
- RSA keys are written to a volume (`GK_KEYS_DIR`) and shared across replicas
- Sessions live in Redis, not in-process memory
- Rate limit counters live in Redis
- Audit log entries are written to a Redis Stream
- RBAC and posture rules are synced from Redis every 10 seconds (`poll_policies()` in `app/main.py`)

This means any proxy replica can handle any request — the production `docker-compose.prod.yml`
runs 3 replicas behind an Nginx load balancer without sticky sessions.

## Consequences

### Positive
- The full stack (`make dev-up`) runs on any machine with Docker, no Kubernetes required
- Railway deployment works without modification — the proxy is a single container
- The Helm chart (`chart/`) supports both standalone service and ingress mode via `values.yaml`
- Policy updates don't require a proxy deploy — edit `policies/authz.rego`, OPA picks it up

### Negative
- The proxy is a choke point for all traffic — a proxy outage affects all upstreams
- mTLS between proxy and upstreams is opt-in, not enforced by default (`GK_MTLS_ENABLED=false`)
- Horizontal scaling requires a load balancer in front of the proxy replicas

### Mitigation
- HPA in the Helm chart scales proxy replicas 2–10 based on CPU/memory
- Health checks on `/proxy/health` enable fast failure detection and restart
- Redis high availability (sentinel or cluster) eliminates the session store as a single point of failure

## References
- `infra/docker-compose.yml` — development stack showing OPA as a sidecar
- `infra/docker-compose.prod.yml` — production stack with Nginx + 3 proxy replicas
- `chart/values.yaml` — Helm chart with HPA configuration
- `gatekeeper-proxy/app/auth/opa.py` — OPA client with decision cache
- `gatekeeper-proxy/app/main.py` — `poll_policies()` for stateless RBAC sync
