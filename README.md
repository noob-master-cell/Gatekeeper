# Gatekeeper Zero-Trust Infrastructure

> A production-grade zero-trust reverse proxy system with authentication, RBAC, mTLS, audit logging, and an admin dashboard.

---

## 🎯 1. What is this project about?
**Gatekeeper** is a production-grade, zero-trust reverse proxy system designed to secure access to internal APIs and services. In a zero-trust architecture, no network request is implicitly trusted just because it originated from an internal network or VPN. Instead, Gatekeeper acts as a hardened perimeter wall that intercepts every single request, verifies cryptographic identity, enforces role-based access control (RBAC), and encrypts traffic before allowing it to touch the actual backend services.

It essentially replaces archaic VPNs with modern, granular, identity-aware routing, ensuring that only authenticated personnel with the correct permissions can access sensitive internal endpoints.

## 🚀 2. What have we done in this project?
Throughout your work on this infrastructure, you have built and hardened an entire ecosystem from the ground up:

### Phase 1: Security Hardening & Zero-Trust Verification
*   **Production Audit:** Conducted a comprehensive security audit resulting in 10 critical fixes, elevating the project from a development playground to a production-ready system.
*   **mTLS (Mutual TLS):** Enforced end-to-end encryption between the Control Plane, the Proxy, and the dummy Backends, meaning even if the internal network is compromised, traffic cannot be sniffed or spoofed.
*   **API Security:** Stripped away insecure bypasses (like the `/auth/dev-login` route) and integrated **true Google OAuth 2.0 (SSO)**, forcing real cryptographic validation for all users.
*   **Defensive Middleware:** Engineered advanced middlewares including nested CSRF protection, strict `SameSite`/`Secure` cookie directives, HSTS headers, and tiered Redis-backed rate limiters.

### Phase 2: Observability & Dashboard Modernization
*   **Teenage Engineering Redesign:** Completely overhauled the React frontend. Stripped away generic gradients and replaced them with a striking, brutalist "Teenage Engineering" aesthetic (Matte charcoal, high-contrast Vermilion/Cyan, rigid structural borders, and tactile modular components).
*   **Mission Control:** Rebuilt the `OverviewView` into a dense, real-time analytics hub. It instantly aggregates the last 500 network requests in the browser, calculates threat-block rates, and identifies top-hit routes and highly active identities at a glance.
*   **Cursor-Based Time Travel:** Broke past the original 100-event limit by engineering a backend Redis cursor that allows administrators to infinitely scroll backward through time in the `TrafficView`. 
*   **Tactile Deep Filtering:** Implemented rapid-slice filtering mechanisms to isolate traffic by Email, Path, Method, and HTTP Status Codes.

### Phase 3: Administrative Control Tools
*   **The Policy Sandbox:** Engineered a pure-simulation mock endpoint (`/admin/policies/simulate`) tied to a frontend terminal UI. Administrators can test hypothetical payload interceptions against the core RBAC engine without generating real HTTP traffic.
*   **Global Kill Switches:** Finished the `UsersView` bulk operations, granting authorized security officers a one-click high-contrast button to instantly revoke all active JSON Web Tokens (JWTs) for a compromised identity via Redis.

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
│   │   ├── main.py            # App entry, catch-all route, JWKS
│   │   ├── proxy.py           # httpx forwarding engine
│   │   ├── config.py          # Pydantic settings (OAuth, JWT, etc.)
│   │   ├── auth/
│   │   │   ├── keys.py        # RSA key management + JWKS
│   │   │   ├── tokens.py      # JWT create/verify (RS256)
│   │   │   └── oauth.py       # OAuth routes + dev login
│   │   └── middleware/
│   │       ├── auth.py        # JWT enforcement middleware
│   │       ├── correlation.py # Correlation ID middleware
│   │       └── logging.py     # Structured request logging
│   ├── tests/
│   ├── Dockerfile
│   └── pyproject.toml
│
├── gatekeeper-backend/        # Dummy HR API (port 8001)
├── gatekeeper-control-plane/  # RBAC, migrations, admin APIs
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
| **Phase 2** | Identity layer (OAuth + JWT) | ✅ Complete |
| **Phase 3** | Policy engine (Redis + RBAC) | ✅ Complete |
| **Phase 4** | Zero-trust networking + observability | ✅ Complete |
| **Phase 5** | Admin dashboard (React) | ✅ Complete |

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

## ✅ Phase 2 — Identity Layer (Done)

End-to-end authentication: Google OAuth login → JWT issuance → middleware enforcement.

### Auth Sequence

```
Browser                Proxy                     Google
  │                      │                          │
  │──GET /login────────►│                          │
  │◄─302 Redirect───────│──────────────────────────│
  │─────────────────────────────────────────────────│
  │◄────────────── code ────────────────────────────│
  │──GET /oauth/callback?code=...──►│               │
  │                      │──POST token exchange────►│
  │                      │◄───── access_token ──────│
  │                      │──GET /userinfo──────────►│
  │                      │◄───── email, name ───────│
  │                      │  Issue RS256 JWT          │
  │◄─302 + Set-Cookie────│  (gatekeeper_token)      │
  │                      │                          │
  │──GET /api/hr/*───────│  (cookie in request)     │
  │   + gatekeeper_token │──Verify JWT──►           │
  │                      │──Forward to backend──►   │
  │◄─────── 200 ─────────│◄──── Response ────────   │
```

### Features

- **Google OAuth 2.0** — `/login` → Google → `/oauth/callback` → JWT cookie
- **RS256 JWT** — RSA-2048 signed, `kid` header, 60-min expiry
- **JWKS** — `/.well-known/jwks.json` for public key discovery
- **Auth middleware** — Enforces JWT on protected routes; public bypass for `/login`, `/health`
- **Dual auth** — `gatekeeper_token` cookie and `Authorization: Bearer` header
- **Dev login** — Styled bypass form at `/auth/dev-login` (dev mode only)
- **Browser redirect** — 302 to `/login` for HTML; 401 JSON for API clients

### Example `curl` Commands (with auth)

```bash
# Dev login (get a token cookie)
curl -X POST http://localhost:8000/auth/dev-login \
  -d "email=dev@test.com&role=admin" -c cookies.txt -L

# Access protected route with cookie
curl -b cookies.txt http://localhost:8000/api/hr/employees

# View JWKS public keys
curl http://localhost:8000/.well-known/jwks.json

# Check current user
curl -b cookies.txt http://localhost:8000/auth/me

# Logout
curl -b cookies.txt http://localhost:8000/auth/logout -L
```

---

## ✅ Phase 3 — Policy Engine (Done)

Route-level RBAC, Redis session management, PostgreSQL user/role models.

### RBAC Policy Map

| Route Pattern | Required Roles | Action on Mismatch |
|--------------|----------------|-------------------|
| `/api/admin/*` | `admin` | 403 Forbidden |
| `/admin/*` | `admin` | 403 Forbidden |
| `/api/hr/*` | `hr`, `admin` | 403 Forbidden |
| `/*` (default) | Any authenticated | 401 Unauthorized |

### Features

- **Redis sessions** — `session:{jti}` with TTL, per-user tracking via `user_sessions:{user_id}`
- **Session revocation** — Single session (`jti`) or all user sessions
- **Fail-closed** — Redis down → 503 (no silent auth bypass)
- **RBAC enforcement** — Middleware checks role intersection against policy map
- **PostgreSQL models** — `users`, `roles`, `user_roles` M2M with Alembic migrations
- **Admin APIs** — User CRUD, role assignment, session list/revoke

### Example `curl` Commands (RBAC)

```bash
# Get session list (admin only)
curl -b cookies.txt http://localhost:8000/admin/sessions

# Revoke a session
curl -X POST http://localhost:8000/admin/sessions/revoke \
  -H 'Content-Type: application/json' \
  -b cookies.txt -d '{"jti": "abc-123"}'

# Revoke all sessions for a user
curl -X POST http://localhost:8000/admin/sessions/revoke \
  -H 'Content-Type: application/json' \
  -b cookies.txt -d '{"user_id": "user-456"}'
```

---

## ✅ Phase 4 — Zero-Trust Networking & Observability (Done)

mTLS, audit logging, production Docker stack, and observability.

### mTLS (Mutual TLS)

```bash
# Generate CA + server + client certificates
make certs

# Enable mTLS in docker-compose
GK_MTLS_ENABLED=true make dev-up
```

| Certificate | Purpose | Location |
|------------|---------|----------|
| `ca.crt` | Certificate Authority | `infra/certs/` |
| `server.crt/key` | Backend server identity | Mounted at `/certs` |
| `client.crt/key` | Proxy client identity | Mounted at `/certs` |

### Audit Logging

- Every authenticated request → `audit:log` Redis stream + structlog
- `/admin/audit-logs?count=100` — retrieve recent audit events
- Fields: `user_id`, `email`, `roles`, `method`, `path`, `status_code`, `duration_ms`

### Docker Stack

```bash
make dev-up     # Build and start all 5 services
make logs       # Follow all logs
make smoke      # Run smoke tests against running stack
make dev-down   # Stop and clean up
```

| Service | Port | Health Check |
|---------|------|-------------|
| Proxy | 8000 | `/proxy/health` |
| Backend | 8001 | `/health` |
| Control Plane | 8002 | `/health` |
| PostgreSQL | 5432 | `pg_isready` |
| Redis | 6379 | `redis-cli ping` |

### Observability

- `/metrics` — service version + runtime info
- Structured JSON logging (structlog) on every service
- Correlation IDs propagated across proxy → backend

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

---

## 🔒 Google SSO Provisioning Guide (Production)

To wire up the newly hardened Gatekeeper instance natively into your Google Workspace, you must supply the proxy with valid OAuth keys.

### 1. Configure the Google Cloud Project
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new Project (or select an existing one).
3. Navigate to **APIs & Services > OAuth consent screen**.
   - Select **External** (or Internal if using a Workspace org).
   - Fill in the required application details (App name, support email).
   - Add scopes: `.../auth/userinfo.email`, `.../auth/userinfo.profile`, and `openid`.
4. Navigate to **Credentials > Create Credentials > OAuth client ID**.
   - Application type: **Web application**.
   - Name: `Gatekeeper Proxy`.
   - **Authorized redirect URIs:** `http://localhost:8000/auth/callback/google` (Or your production URL).

### 2. Inject Keys into the Environment
In your `infra/.env` file, populate the OAuth keys generated from Google:

```env
GK_GOOGLE_CLIENT_ID=your-client-id-here.apps.googleusercontent.com
GK_GOOGLE_CLIENT_SECRET=your-client-secret-here
GK_GOOGLE_REDIRECT_URI=http://localhost:8000/auth/callback/google
```

The system will now securely issue encrypted JWT session cookies upon successful Google callback!
