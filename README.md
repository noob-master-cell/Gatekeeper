# Gatekeeper Zero-Trust Infrastructure

> A production-grade zero-trust reverse proxy system with authentication, RBAC, mTLS, audit logging, and an admin dashboard.

---

## 🎯 Problem Statement

Modern organizations need to **secure access to internal APIs** without trusting any network boundary. Traditional perimeter-based security fails when:

- Employees access services from anywhere (remote, VPN, cloud).
- Internal APIs are exposed between microservices with no access control.
- There's no audit trail of who accessed what, when.

**Gatekeeper** solves this by placing a **zero-trust reverse proxy** between clients and backend services that enforces:

1. **Authentication** — Google OAuth → JWT token issuance
2. **Authorization** — RBAC with Redis-cached policies
3. **Encryption** — mTLS between proxy and backends
4. **Observability** — Structured audit logging with correlation IDs
5. **Administration** — Real-time traffic monitoring and session management

---

## 🏗 Architecture

```
                    ┌─────────────────────────────────────────────┐
                    │            GATEKEEPER SYSTEM                │
                    │                                             │
  Browser/Client    │  ┌──────────────┐    ┌──────────────────┐   │
  ──── HTTPS ──────►│  │   PROXY      │    │    BACKEND       │   │
                    │  │  (port 8000)  │──►│   (port 8001)    │   │
                    │  │              │mTLS│                  │   │
                    │  │  • Auth      │    │  • /health       │   │
                    │  │  • RBAC      │    │  • /api/hr/*     │   │
                    │  │  • Audit     │    │                  │   │
                    │  │  • Forward   │    └──────────────────┘   │
                    │  └──────┬───────┘                           │
                    │         │                                   │
                    │    ┌────┴────┐    ┌──────────────────┐      │
                    │    │  Redis  │    │   PostgreSQL     │      │
                    │    │Sessions │    │  Users, Roles,   │      │
                    │    │& Cache  │    │  Audit Logs      │      │
                    │    └─────────┘    └──────────────────┘      │
                    │                                             │
                    │  ┌──────────────────────────────────────┐   │
                    │  │     CONTROL PLANE + DASHBOARD        │   │
                    │  │  • Admin APIs  • Live Traffic View   │   │
                    │  │  • User Mgmt   • Session Management  │   │
                    │  └──────────────────────────────────────┘   │
                    └─────────────────────────────────────────────┘
```

---

## 📂 Repository Structure

```
zti/
├── gatekeeper-proxy/          # FastAPI reverse proxy (port 8000)
│   ├── app/
│   │   ├── main.py            # App entry, catch-all route
│   │   ├── proxy.py           # httpx forwarding engine
│   │   ├── config.py          # Pydantic settings
│   │   └── middleware/
│   │       ├── correlation.py # Correlation ID middleware
│   │       └── logging.py     # Structured request logging
│   ├── tests/
│   ├── Dockerfile
│   └── pyproject.toml
│
├── gatekeeper-backend/        # Dummy HR API (port 8001)
│   ├── app/main.py
│   ├── tests/
│   ├── Dockerfile
│   └── pyproject.toml
│
├── gatekeeper-control-plane/  # RBAC, migrations, admin APIs
│   ├── app/main.py
│   ├── tests/
│   └── pyproject.toml
│
├── gatekeeper-dashboard/      # React + Tailwind admin UI
│
├── infra/
│   ├── docker-compose.yml     # All services orchestration
│   ├── generate-certs.sh      # mTLS cert generation
│   └── .env.example
│
├── .github/workflows/ci.yml   # CI: lint + test on PRs
├── Makefile                   # Dev commands
└── README.md
```

---

## 🚦 Progress Tracker

| Phase | Description | Status |
|-------|------------|--------|
| **Phase 0** | Repo skeleton, tooling, CI | ✅ Complete |
| **Phase 1** | Core proxy engine | ✅ Complete |
| **Phase 2** | Identity layer (OAuth + JWT) | ⬜ Not started |
| **Phase 3** | Policy engine (Redis + RBAC) | ⬜ Not started |
| **Phase 4** | Zero-trust networking + observability | ⬜ Not started |
| **Phase 5** | Admin dashboard (React) | ⬜ Not started |

---

## ✅ Phase 1 — Core Proxy Engine (Done)

The proxy correctly forwards requests from port `8000` to the dummy backend on port `8001`.

### Features Implemented

- **Catch-all routing** — `/{path:path}` forwards GET, POST, PUT, DELETE, PATCH, OPTIONS
- **Connection pooling** — httpx.AsyncClient with configurable pool size
- **Header processing** — Strips hop-by-hop headers, injects `X-Forwarded-For/Proto/Host`
- **Error mapping** — Backend 5xx → 502, timeouts → 504, connection errors → 502
- **Streaming support** — Async response streaming for large payloads
- **Correlation ID** — Auto-generated UUID per request, preserved if provided
- **Structured logging** — JSON logs with method, path, status, latency, correlation ID

### Example `curl` Commands

```bash
# Start the services
make dev-up

# Health check (proxy's own)
curl http://localhost:8000/proxy/health
# → {"status":"ok","service":"gatekeeper-proxy","timestamp":"..."}

# Health check (forwarded to backend)
curl http://localhost:8000/health
# → {"status":"ok","service":"gatekeeper-backend","timestamp":"..."}

# List employees
curl http://localhost:8000/api/hr/employees
# → {"data":[{"id":1,"name":"Alice Johnson",...}],"count":5,"timestamp":"..."}

# Filter by department
curl "http://localhost:8000/api/hr/employees?department=Engineering"
# → {"data":[...],"count":2,"timestamp":"..."}

# Create HR request
curl -X POST http://localhost:8000/api/hr/requests \
  -H "Content-Type: application/json" \
  -d '{"type":"leave","description":"Annual leave"}'
# → {"data":{"id":"...","type":"leave","status":"pending",...},"message":"..."}

# With custom correlation ID
curl -H "X-Correlation-ID: my-trace-123" http://localhost:8000/health
# → Response includes X-Correlation-ID: my-trace-123
```

---

## 🛠 Quick Start

### Prerequisites

- Python 3.11+
- Docker & Docker Compose
- Node.js 20+ and pnpm (for dashboard)

### Local Development

```bash
# Install Python dependencies
cd gatekeeper-proxy && pip install -e ".[dev]" && cd ..
cd gatekeeper-backend && pip install -e ".[dev]" && cd ..

# Run backend
cd gatekeeper-backend && uvicorn app.main:app --port 8001 --reload &

# Run proxy
cd gatekeeper-proxy && uvicorn app.main:app --port 8000 --reload &

# Or use Docker
make dev-up
```

### Run Tests

```bash
# All Python tests
make test-all

# Individual services
make test-proxy
make test-backend
make test-control-plane

# With verbose output
cd gatekeeper-proxy && python -m pytest tests/ -v
```

### Run Linters

```bash
make lint       # All Python services
make lint-proxy # Just the proxy
```

---

## 📜 License

MIT
