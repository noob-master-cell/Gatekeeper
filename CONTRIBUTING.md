# Gatekeeper — Contributing

## Development Environment Setup

### Prerequisites

- Python 3.11+
- Docker and Docker Compose v2
- GNU Make

### Steps

```bash
git clone https://github.com/noob-master-cell/Gatekeeper.git
cd Gatekeeper
make install
make dev-up
```

`make install` runs `pip install -e ".[dev]"` in each of the three Python services (`gatekeeper-proxy`, `gatekeeper-backend`, `gatekeeper-control-plane`). The `[dev]` extras install pytest, pytest-asyncio, pytest-cov, ruff, mypy, and httpx.

`make dev-up` builds and starts all containers defined in `infra/docker-compose.yml` in detached mode. All services start with `GK_DEV_MODE=true`.

To tail logs across all services: `make logs`  
Service-specific logs: `make proxy-logs`, `make backend-logs`, `make cp-logs`

To stop and remove everything including volumes: `make dev-down`

## Project Structure

```
Gatekeeper/
├── gatekeeper-proxy/           Reverse proxy — auth, rate limiting, OPA, forwarding
│   ├── app/
│   │   ├── auth/               OAuth flow, JWT issuance/verification, RBAC engine,
│   │   │                       RSA key management, Redis sessions, API keys, OPA client
│   │   ├── middleware/         Ordered middleware stack (auth, ratelimit, CSRF, posture,
│   │   │                       security headers, logging, metrics, correlation ID)
│   │   ├── observability/      Prometheus metrics, OpenTelemetry tracing, structlog config
│   │   ├── proxy.py            Core httpx-based request forwarding
│   │   ├── config.py           pydantic-settings configuration (GK_* env vars)
│   │   └── main.py             FastAPI app, middleware registration, lifespan, routes
│   ├── tests/                  pytest test suite (test_auth.py, test_proxy.py, test_rbac.py)
│   └── pyproject.toml          Dependencies, ruff config, pytest config
│
├── gatekeeper-control-plane/   User/role/policy management REST API
│   ├── app/
│   │   ├── models.py           SQLAlchemy ORM models (users, roles, policies, posture rules)
│   │   ├── services/           Business logic (user management, policy CRUD, Redis sync)
│   │   ├── middleware/         Control plane middleware
│   │   ├── config.py           GK_CP_* settings
│   │   ├── database.py         AsyncPG session factory
│   │   └── main.py             FastAPI app and routers
│   └── pyproject.toml
│
├── gatekeeper-backend/         Sample protected backend (simulates a real upstream)
│   └── Dockerfile
│
├── gatekeeper-dashboard/       React 18 + TypeScript admin dashboard
│   └── src/
│       ├── App.tsx             Auth-gated root component
│       ├── api.ts              API client layer (calls proxy and control plane)
│       ├── OverviewView.tsx    Real-time request stats
│       ├── TrafficView.tsx     Live audit log viewer
│       ├── SessionsView.tsx    Session management
│       ├── PoliciesView.tsx    RBAC policy editor and sandbox
│       └── PostureView.tsx     Device posture rules
│
├── infra/                      Docker Compose files, nginx, Prometheus, Grafana configs
│   ├── docker-compose.yml      Development stack
│   ├── docker-compose.prod.yml Production stack (3 proxy replicas, nginx, no observability)
│   ├── prometheus.yml          Prometheus scrape config
│   ├── otel-collector.yml      OpenTelemetry collector pipeline config
│   └── grafana/                Grafana provisioning and dashboard JSON
│
├── policies/
│   └── authz.rego              OPA Rego policy (hot-reloadable)
│
├── chart/                      Helm chart for Kubernetes deployment
│   └── values.yaml
│
├── benchmarks/                 k6 load test scripts
│   └── k6/gatekeeper.js
│
├── Makefile                    All common development commands
└── .github/workflows/ci.yml   CI pipeline (lint → test → build → push)
```

## Running Tests

Run all three services' test suites in sequence:

```bash
make test-all
```

Run a single service:

```bash
make test-proxy        # cd gatekeeper-proxy && pytest tests/ -v --cov=app --cov-report=term-missing
make test-backend      # cd gatekeeper-backend && pytest tests/ -v
make test-control-plane  # cd gatekeeper-control-plane && pytest tests/ -v
```

The proxy test suite targets 50% minimum coverage (`fail_under = 50` in `pyproject.toml`). Tests use `pytest-asyncio` with `asyncio_mode = "auto"`.

Smoke tests against the running Docker stack:

```bash
make smoke   # runs infra/smoke-tests.sh
```

## Linting and Formatting

All Python services use `ruff` for both linting and formatting.

Check for lint errors:

```bash
make lint          # runs ruff check on all three services
make lint-proxy    # proxy only
make lint-backend  # backend only
make lint-control-plane
```

Auto-fix and format:

```bash
make fmt   # ruff format + ruff check --fix across all three services
```

Ruff configuration is in each service's `pyproject.toml`. Key settings for the proxy (`gatekeeper-proxy/pyproject.toml`):

- `target-version = "py311"`
- `line-length = 100`
- Enabled rule sets: `E`, `F`, `I`, `N`, `W`, `UP`, `B`, `SIM`

CI runs `ruff check` and `ruff format --check` on every push and pull request (`jobs.lint` in `.github/workflows/ci.yml`). A PR cannot be merged if either check fails.

## Service Ownership

Before making changes, identify which service owns the functionality:

| Area | Service | Key files |
|---|---|---|
| Authentication (OAuth, JWT, sessions) | `gatekeeper-proxy` | `app/auth/oauth.py`, `app/auth/tokens.py`, `app/auth/sessions.py`, `app/auth/keys.py` |
| Authorization (RBAC, OPA) | `gatekeeper-proxy` | `app/auth/rbac.py`, `app/auth/opa.py`, `app/middleware/auth.py` |
| Rate limiting | `gatekeeper-proxy` | `app/middleware/ratelimit.py` |
| CSRF / security headers | `gatekeeper-proxy` | `app/middleware/csrf.py`, `app/middleware/security_headers.py` |
| Device posture | `gatekeeper-proxy` | `app/middleware/posture.py` |
| API keys | `gatekeeper-proxy` | `app/auth/api_keys.py` |
| Request forwarding | `gatekeeper-proxy` | `app/proxy.py` |
| Observability (metrics, tracing, logging) | `gatekeeper-proxy` | `app/observability/` |
| User and role management | `gatekeeper-control-plane` | `app/models.py`, `app/services/` |
| RBAC policy CRUD | `gatekeeper-control-plane` | `app/services/` |
| Admin dashboard UI | `gatekeeper-dashboard` | `src/` |
| Infrastructure / networking | `infra/` | `docker-compose.yml`, `nginx.conf`, `prometheus.yml` |
| OPA policy logic | `policies/` | `authz.rego` |

## Pull Request Process

### Branch Naming

```
feat/<short-description>       New feature
fix/<short-description>        Bug fix
docs/<short-description>       Documentation only
refactor/<short-description>   Code restructuring with no behavior change
chore/<short-description>      Tooling, dependencies, CI changes
```

### PR Description Template

```markdown
## What

Brief description of what the change does.

## Why

Why this change is needed. Link to any related issue.

## Testing

- [ ] Unit tests added or updated
- [ ] `make test-all` passes locally
- [ ] `make lint` passes locally
- [ ] Smoke tested against `make dev-up`
```

### CI Checks

All of the following must pass before a PR can be merged:

1. **lint** (`jobs.lint`): `ruff check` and `ruff format --check` run as a matrix across `gatekeeper-proxy`, `gatekeeper-backend`, and `gatekeeper-control-plane`.
2. **test** (`jobs.test`): `pytest tests/ -v --tb=short` run as a matrix across the same three services.
3. **build** (`jobs.build`): Docker images are built and pushed to GHCR on pushes to `main`. Build is gated on lint and test passing.

On version tags (`v*`), a Trivy security scan runs against the published images.

## Commit Message Format

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>

[optional body]

[optional footer]
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `ci`

Scopes (optional): `proxy`, `control-plane`, `dashboard`, `backend`, `infra`, `opa`, `ci`

Examples:

```
feat(proxy): add per-API-key rate limit override
fix(proxy): handle Redis timeout in session check without crashing
docs: add ARCHITECTURE.md
chore(ci): pin ruff to 0.8.0 in CI matrix
```

Breaking changes: add `!` after the type/scope and a `BREAKING CHANGE:` footer.

## Adding a New OPA Policy Rule

OPA policies live in `policies/authz.rego`. OPA watches the `/policies` directory and reloads on file change.

1. Edit `policies/authz.rego`. The file uses `rego.v1` syntax.

2. Add a new `allow` rule. Example — restrict `/api/finance/*` to the `finance` or `admin` role:

   ```rego
   allow if {
       glob.match("/api/finance/*", [], input.path)
       some role in input.user.roles
       role in {"finance", "admin"}
   }
   ```

3. Add a corresponding `reason` rule so callers know why a decision was made:

   ```rego
   reason := "finance_role_granted" if {
       allow
       glob.match("/api/finance/*", [], input.path)
   }
   ```

4. Test the policy with the OPA CLI (if installed):

   ```bash
   echo '{"input":{"method":"GET","path":"/api/finance/report","path_parts":["api","finance","report"],"user":{"id":"u1","email":"bob@co","roles":["finance"]},"client_ip":"127.0.0.1","timestamp":"2026-05-09T00:00:00Z"}}' \
     | opa eval -d policies/authz.rego -I 'data.gatekeeper.authz'
   ```

5. Alternatively, use the RBAC sandbox in the dashboard at `/policies` → "Simulate" to test decisions without deploying.

6. After deploying, OPA picks up the change automatically. The proxy's in-process OPA decision cache (30-second TTL) will converge within 30 seconds, or you can restart the proxy to flush it immediately.

## Environment Variables

### For local development (without Docker)

Create a `.env` file in the service directory and export variables before running `uvicorn`:

```bash
# gatekeeper-proxy/.env
GK_REDIS_URL=redis://localhost:6379/0
GK_DEV_MODE=true
GK_DEV_LOGIN_ENABLED=true
GK_LOG_FORMAT=console
GK_LOG_LEVEL=DEBUG
```

Then:

```bash
cd gatekeeper-proxy
set -a && source .env && set +a
uvicorn app.main:app --reload --port 8000
```

### For Docker Compose (dev)

All environment variables for the dev stack are defined directly in `infra/docker-compose.yml`. Variables that differ between developers (Google OAuth credentials) can be overridden by creating `infra/.env` — Docker Compose reads it automatically for `${VAR}` interpolations.

### For Docker Compose (production)

All variables are injected via `infra/.env` and referenced as `${VAR}` in `infra/docker-compose.prod.yml`. See DEPLOYMENT.md for the full list of required production variables.

Never commit `.env` files. They are gitignored.
