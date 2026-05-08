# Gatekeeper — Deployment

## Prerequisites

- Docker 24+ and Docker Compose v2 (the `docker compose` subcommand, not the legacy `docker-compose` binary)
- Python 3.11+ with `pip` (for local development without Docker)
- GNU Make (for convenience targets in `Makefile`)
- Google OAuth 2.0 credentials (required for production; optional in dev mode)

## Development Quickstart

```bash
git clone https://github.com/noob-master-cell/Gatekeeper.git
cd Gatekeeper
make dev-up
```

`make dev-up` runs `docker compose -f infra/docker-compose.yml up --build -d`. All services start with `GK_DEV_MODE=true` and `GK_DEV_LOGIN_ENABLED=true`, which enables the `/auth/dev-login` bypass. No Google credentials are needed.

After all containers are healthy:

| URL | Service |
|---|---|
| `http://localhost:8000` | Proxy (all client traffic) |
| `http://localhost:8001` | Backend API (direct access, no auth) |
| `http://localhost:8002` | Control Plane API |
| `http://localhost:8181` | OPA UI and REST API |
| `http://localhost:9090` | Prometheus |
| `http://localhost:3001` | Grafana (`admin` / `gatekeeper`) |

To stop and remove volumes: `make dev-down`.

### Dev login

```bash
curl -c cookies.txt -X POST http://localhost:8000/auth/dev-login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@test.local", "roles": ["admin"]}'
```

This returns a `gatekeeper_token` cookie. Pass `-b cookies.txt` on subsequent requests.

## Environment Variables Reference

All proxy variables use the `GK_` prefix (pydantic-settings reads them automatically). Control plane variables use `GK_CP_`.

### Proxy (`gatekeeper-proxy`)

| Variable | Description | Default | Required |
|---|---|---|---|
| `GK_BACKEND_URL` | URL of the protected backend service | `http://localhost:8001` | Yes |
| `GK_CONTROL_PLANE_URL` | URL of the control plane service | `http://localhost:8002` | Yes |
| `GK_REDIS_URL` | Redis connection string | `redis://localhost:6379/0` | Yes |
| `GK_GOOGLE_CLIENT_ID` | Google OAuth 2.0 client ID | `""` | Production |
| `GK_GOOGLE_CLIENT_SECRET` | Google OAuth 2.0 client secret | `""` | Production |
| `GK_GOOGLE_REDIRECT_URI` | OAuth callback URL (must match Google Console) | `http://localhost:8000/oauth/callback` | Production |
| `GK_DEV_MODE` | Enable dev mode (disables HSTS, allows dev login) | `false` | No |
| `GK_DEV_LOGIN_ENABLED` | Enable `/auth/dev-login` bypass | `true` | No |
| `GK_JWT_EXPIRY_MINUTES` | JWT token lifetime in minutes | `60` | No |
| `GK_KEYS_DIR` | Directory to persist RSA key pairs | `/tmp/gatekeeper_keys` | No |
| `GK_JWKS_ROTATION_HOURS` | How often to rotate signing keys | `720` (30 days) | No |
| `GK_MTLS_ENABLED` | Enable mutual TLS for upstream connections | `false` | No |
| `GK_MTLS_CERT_DIR` | Directory containing mTLS certificates | `/certs` | If mTLS |
| `GK_CP_API_KEY` | API key for control plane inter-service calls | `""` | Yes |
| `GK_OPA_ENABLED` | Enable OPA policy evaluation | `false` | No |
| `GK_OPA_URL` | OPA server base URL | `http://localhost:8181` | If OPA |
| `GK_OPA_POLICY_PATH` | OPA REST path for policy data | `v1/data/gatekeeper/authz` | If OPA |
| `GK_OPA_FAIL_OPEN` | Allow requests when OPA is unreachable | `false` | No |
| `GK_LOG_LEVEL` | Logging level (`DEBUG`, `INFO`, `WARNING`) | `INFO` | No |
| `GK_LOG_FORMAT` | Log format (`console` or `json`) | `console` | No |
| `GK_CORS_ORIGINS` | Comma-separated allowed CORS/CSRF origins | `http://localhost:3000,...` | Production |
| `GK_ENVIRONMENT` | Deployment environment label for traces | `development` | No |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP gRPC endpoint for traces | `""` | No |
| `OTEL_SERVICE_NAME` | Service name in traces | `gatekeeper-proxy` | No |

### Control Plane (`gatekeeper-control-plane`)

| Variable | Description | Default | Required |
|---|---|---|---|
| `GK_CP_DATABASE_URL` | PostgreSQL connection string (asyncpg driver) | — | Yes |
| `GK_CP_REDIS_URL` | Redis connection string | — | Yes |
| `GK_CP_API_KEY` | API key expected from the proxy | `dev-api-key-change-me` | Yes |
| `GK_CP_LOG_LEVEL` | Logging level | `INFO` | No |
| `GK_CP_MTLS_ENABLED` | Enable mTLS for incoming connections | `false` | No |

### Dashboard (`gatekeeper-dashboard`)

| Variable | Description | Default | Required |
|---|---|---|---|
| `PROXY_URL` | Internal URL of the proxy (for API calls) | — | Yes |

## Production Docker Compose

`infra/docker-compose.prod.yml` is the production compose file. It differs from the dev file in the following ways:

- Proxy runs 3 replicas with CPU/memory limits (`1.0` CPU, `512M` memory per replica).
- An nginx load balancer listens on ports `443` and `80` (config: `infra/nginx.conf`).
- All secrets come from an `.env` file rather than hard-coded values.
- Redis requires a password (`REDIS_PASSWORD`).
- No OPA, Prometheus, or Grafana containers — these are expected to run externally or be added separately.

Usage:

```bash
cp infra/.env.example infra/.env   # edit with real values
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env up -d
```

Required `.env` keys for production:

```env
GK_BACKEND_URL=http://backend:8001
GK_CONTROL_PLANE_URL=http://control-plane:8002
GK_REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379/0
GK_GOOGLE_CLIENT_ID=<your-client-id>
GK_GOOGLE_CLIENT_SECRET=<your-client-secret>
GK_GOOGLE_REDIRECT_URI=https://yourdomain.com/oauth/callback
GK_DEV_MODE=false
GK_DEV_LOGIN_ENABLED=false
GK_CP_API_KEY=<random-256-bit-hex>
GK_KEYS_DIR=/keys
GK_JWT_EXPIRY_MINUTES=60
GK_CORS_ORIGINS=https://yourdomain.com
GK_CP_DATABASE_URL=postgresql+asyncpg://gatekeeper:<password>@postgres:5432/gatekeeper
GK_CP_REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379/0
POSTGRES_USER=gatekeeper
POSTGRES_PASSWORD=<strong-password>
POSTGRES_DB=gatekeeper
REDIS_PASSWORD=<strong-password>
```

## Kubernetes / Helm Deployment

The chart is in `chart/`. The proxy image is `ghcr.io/noob-master-cell/gatekeeper-proxy:0.1.0`.

Basic install with a dedicated namespace:

```bash
helm install gatekeeper ./chart \
  --namespace gatekeeper \
  --create-namespace \
  --set backend.url=http://your-backend-service:8001 \
  --set controlPlane.url=http://your-cp-service:8002 \
  --set redis.url=redis://your-redis:6379/0 \
  --set env.GK_DEV_MODE=false \
  --set env.GK_ENVIRONMENT=production
```

The convenience target in `Makefile` is `make helm-install` (uses chart defaults).

### Key values to override

| Value | Description | Default |
|---|---|---|
| `image.tag` | Proxy image tag | `0.1.0` |
| `replicaCount` | Number of proxy replicas | `2` |
| `autoscaling.enabled` | Enable HPA | `false` |
| `autoscaling.maxReplicas` | HPA max | `10` |
| `backend.url` | Backend service URL | `http://backend:8001` |
| `controlPlane.url` | Control plane URL | `http://control-plane:8002` |
| `redis.url` | Redis URL | `redis://gatekeeper-redis:6379/0` |
| `opa.enabled` | Enable OPA sidecar | `false` |
| `opa.failOpen` | OPA fail-open mode | `false` |
| `observability.prometheus.serviceMonitor.enabled` | Create a Prometheus `ServiceMonitor` | `false` |
| `observability.tracing.otlpEndpoint` | OTLP collector endpoint | `""` |
| `ingress.enabled` | Expose via ingress | `false` |
| `ingress.hosts[0].host` | Ingress hostname | `gatekeeper.example.com` |

Secrets (Google credentials, DB URL, Redis password) should be supplied via Kubernetes `Secret` objects and referenced in `values.yaml` under `env`, or injected via a secrets manager (e.g., External Secrets Operator).

To upgrade: `make helm-upgrade`  
To uninstall: `make helm-uninstall`

## Secrets Management

The following values must be treated as secrets and never committed to source control:

| Secret | Where used |
|---|---|
| `GK_GOOGLE_CLIENT_SECRET` | Proxy — OAuth token exchange |
| `GK_CP_API_KEY` | Proxy ↔ Control Plane inter-service auth |
| `GK_CP_DATABASE_URL` (password component) | Control Plane → PostgreSQL |
| `GK_CP_REDIS_URL` (password component) | Control Plane → Redis |
| `GK_REDIS_URL` (password component) | Proxy → Redis |
| `POSTGRES_PASSWORD` | PostgreSQL root password |
| `REDIS_PASSWORD` | Redis `requirepass` |

In Docker Compose, supply them via `infra/.env` (never commit this file). In Kubernetes, use `kubectl create secret generic` or an operator.

The RSA private key files in `GK_KEYS_DIR` (`private.pem`, `prev_private.pem`) are also sensitive. In Kubernetes, mount them from a `Secret` volume rather than a `hostPath`.

## TLS / mTLS Setup

### TLS Termination

In production, TLS is terminated at nginx (`infra/docker-compose.prod.yml`). Place certificates in the `certs` Docker volume and reference them in `infra/nginx.conf`. The proxy itself runs HTTP internally.

### mTLS (Service-to-Service)

When `GK_MTLS_ENABLED=true`, the proxy presents a client certificate to the backend and verifies the backend's certificate against a trusted CA. Generate development mTLS certificates with:

```bash
make certs
```

This runs `infra/generate-certs.sh`, which creates a self-signed CA plus proxy and backend certificate/key pairs under `infra/certs/`. The `certs` volume is then mounted read-only into both the proxy and backend containers as configured in `infra/docker-compose.prod.yml`.

Set `GK_MTLS_CERT_DIR` (proxy) to the directory containing `client.crt`, `client.key`, and `ca.crt`.

## Health Checks and Readiness

The proxy exposes a single health endpoint:

```
GET /proxy/health
```

Response (200):
```json
{
  "status": "ok",
  "service": "gatekeeper-proxy",
  "version": "0.1.0",
  "timestamp": "2026-05-09T12:00:00Z"
}
```

This endpoint is excluded from authentication, rate limiting, Prometheus metrics collection, and CSRF checks. Docker Compose health checks poll it every 10 seconds with a 3-second timeout and 3 retries. The Helm chart configures both `livenessProbe` and `readinessProbe` against `GET /proxy/health:8000` (initial delay 5–10 seconds, period 5–15 seconds).

The backend exposes `GET /health` and the control plane exposes `GET /health` on their respective ports.

## Scaling Guidance

**Proxy replicas are stateless.** All session, rate-limit, and audit state lives in Redis. You can run any number of proxy replicas behind a load balancer and they share state correctly, subject to the following:

- The OPA decision cache (`app/auth/opa.py`) is per-process and converges within 30 seconds of a policy change.
- The RBAC/posture in-memory cache is refreshed every 10 seconds from Redis by each replica independently.
- RSA keys are stored in `GK_KEYS_DIR`. In a multi-replica Kubernetes deployment, mount this path from a `PersistentVolume` (or `Secret`) shared across all replicas so that all instances sign and verify with the same key pair.

For Redis, run a Redis Sentinel or Cluster deployment in production. The proxy uses `redis.asyncio` with `retry_on_timeout=True`.

For PostgreSQL (control plane), a single instance is sufficient for the control plane's write load. Read replicas can be added behind a proxy (e.g., PgBouncer).

## Monitoring

Prometheus scrapes the proxy at `http://proxy:8000/metrics` every 5 seconds. In the development stack, Prometheus runs at `http://localhost:9090`.

Grafana runs at `http://localhost:3001` with default credentials `admin` / `gatekeeper`. Pre-provisioned dashboards are loaded from `infra/grafana/dashboards/` at startup. The Prometheus data source is provisioned via `infra/grafana/provisioning/datasources/`.

Key dashboards to check first:
- Request rate, error rate, and latency percentiles from `gatekeeper_requests_total` and `gatekeeper_request_duration_seconds`.
- Auth event breakdown from `gatekeeper_auth_events_total` (labels: `success`, `token_expired`, `token_invalid`, `session_revoked`, `missing_token`).
- Rate limit rejections from `gatekeeper_rate_limit_hits_total`.
- Policy decisions from `gatekeeper_policy_decisions_total` (labels: `engine=rbac|opa`, `decision=allow|deny`).

To print the observability URLs at any time: `make metrics`.
