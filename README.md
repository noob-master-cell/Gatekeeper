<p align="center">
  <img src="https://img.shields.io/badge/GATEKEEPER-Zero_Trust_Gateway-FF3A20?style=for-the-badge&labelColor=121212" alt="Gatekeeper" />
</p>

<h1 align="center">🛡️ Gatekeeper</h1>

<p align="center">
  <strong>A production-grade Zero-Trust Reverse Proxy Gateway</strong><br/>
  <em>Inspired by Google BeyondCorp · Built from scratch · Self-hosted</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/python-3.11-blue?style=flat-square" />
  <img src="https://img.shields.io/badge/fastapi-0.110+-009688?style=flat-square" />
  <img src="https://img.shields.io/badge/react-18+-61DAFB?style=flat-square" />
  <img src="https://img.shields.io/badge/docker-compose-2496ED?style=flat-square" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" />
</p>

---

## 📌 The Problem

Traditional enterprise security relies on **VPNs and perimeter firewalls** — once you're inside the network, you're implicitly trusted. This creates massive vulnerabilities:

- **Lateral movement**: An attacker who compromises one machine can freely access every internal service
- **No per-request verification**: VPNs grant blanket access to the entire network
- **Zero visibility**: No audit trail of who accessed what, when, and from where
- **Remote work challenges**: VPNs are slow, fragile, and painful to scale

Google solved this internally with **BeyondCorp** — a zero-trust architecture where *every single request* is authenticated, authorized, and audited, regardless of network location. There is no "inside" or "outside" the network.

**Gatekeeper is small levle implementation of this exact principle.**

---

## 💡 The Solution

Gatekeeper is a **reverse proxy gateway** that sits between the internet and your internal services. Every request must pass through Gatekeeper, where it is:

1. **Authenticated** — "Who are you?" (Google OAuth 2.0 + RS256 JWT)
2. **Authorized** — "Are you allowed to access this?" (RBAC policy engine)
3. **Inspected** — "Is your device trustworthy?" (IP/User-Agent posture checks)
4. **Audited** — "What did you do?" (Redis-streamed audit logs with correlation IDs)
5. **Encrypted** — "Is the channel secure?" (mTLS between services)

If any check fails, the request is **denied immediately** — even if the user is on the corporate network.

```
                    ┌─────────────────────────────────────────────────┐
                    │              GATEKEEPER PROXY                   │
   Internet         │                                                 │
   Request  ──────► │  [Device Posture] → [Rate Limit] → [Auth/JWT]  │
                    │        │                                │       │
                    │        ▼                                ▼       │
                    │   Block bad IPs              Verify RS256 JWT   │
                    │   Block bad UAs              Check Redis session│
                    │                              Enforce RBAC       │        ┌──────────┐
                    │                                    │            │ ──────► │ Backend  │
                    │                                    ▼            │        │ Services │
                    │                            [Audit Log to Redis] │        └──────────┘
                    │                            [Forward Request]    │
                    └─────────────────────────────────────────────────┘
```

---

## 🏗️ Architecture

Gatekeeper is composed of **5 containerized microservices**, each with a single responsibility:

| Service | Role | Tech |
|---------|------|------|
| **Proxy** | The gateway itself — authenticates, authorizes, rate-limits, and forwards every request | Python, FastAPI, httpx |
| **Backend** | Your protected application (sample API included) | Python, FastAPI |
| **Control Plane** | Manages RBAC policies, user roles, posture rules, and traffic metrics | Python, FastAPI, SQLAlchemy |
| **Dashboard** | Real-time admin UI for monitoring and management | React, TypeScript, Recharts |
| **Infrastructure** | Redis (sessions/audit), PostgreSQL (policies/users), Nginx (load balancer) | Docker Compose |

### How the Services Connect

```mermaid
graph LR
    Client[👤 Browser/API Client] --> Proxy[🛡️ Proxy Gateway]
    Proxy --> Backend[⚙️ Backend API]
    Proxy --> CP[🎛️ Control Plane]
    Proxy --> Redis[(🔴 Redis)]
    CP --> PG[(🐘 PostgreSQL)]
    CP --> Redis
    Dashboard[📊 Dashboard] --> Proxy
```

---

## 🔐 Security Features — Deep Dive

### 1. Authentication: Google OAuth 2.0 + RS256 JWTs

Users authenticate via Google Workspace SSO. On successful login, Gatekeeper:
- Issues an **RS256-signed JWT** (asymmetric cryptography — only the proxy can sign, anyone can verify)
- Stores a **session in Redis** with the JWT ID (`jti`) as the key
- Sets a **`gatekeeper_token` cookie** with `HttpOnly`, `Secure`, and `SameSite=Lax` flags

Every subsequent request is verified by:
1. Extracting the JWT from the cookie (or `Authorization: Bearer` header)
2. Verifying the RS256 signature against the public key
3. Checking Redis to ensure the session hasn't been revoked
4. Extracting roles from the Redis session (roles can be updated without re-issuing tokens)

### 2. Authorization: Role-Based Access Control (RBAC)

The RBAC engine maps URL patterns to required roles using a priority-ordered policy table:

| Pattern | Required Roles | Effect |
|---------|---------------|--------|
| `^/api/admin(/.*)?$` | `admin` | Admin-only endpoints |
| `^/admin(/.*)?$` | `admin` | Dashboard API routes |
| `^/api/hr(/.*)?$` | `hr`, `admin` | HR endpoints (HR or Admin) |
| `^/.*$` | Any authenticated | Default — just need a valid session |

Policies are stored in PostgreSQL (via the Control Plane), synced to Redis every 10 seconds, and cached in-memory with a 30-second TTL for near-zero latency.

### 3. Device Posture Enforcement

Before authentication even begins, Gatekeeper inspects the connection itself:

- **IP Blocklist**: Block known malicious IPs or restrict access to specific networks
- **User-Agent Rules**: Block outdated browsers, curl scripts, or suspicious bots using regex patterns

Rules are managed through the dashboard and synced from Redis in real-time.

### 4. Audit Logging

Every request that passes through the proxy is logged to a **Redis Stream** (`audit:log`):

```json
{
  "timestamp": "2024-01-15T10:30:45Z",
  "action": "request_proxied",
  "email": "alice@company.com",
  "roles": ["admin"],
  "method": "GET",
  "path": "/api/admin/users",
  "status_code": 200,
  "client_ip": "203.0.113.42",
  "correlation_id": "a1b2c3d4-e5f6-7890",
  "duration_ms": 45.2
}
```

Logs support filtering by email, path, method, and status code — with cursor-based pagination for streaming through large datasets.

### 5. Rate Limiting

Token-bucket rate limiting protects against brute-force attacks:
- **20 requests per minute per IP** (configurable)
- Returns `429 Too Many Requests` with `X-RateLimit-*` headers
- Tracked per-IP in memory with automatic expiration

### 6. Mutual TLS (mTLS)

When enabled, all service-to-service communication is encrypted with mutual TLS:
- The proxy presents a client certificate to the backend
- The backend verifies the certificate against a trusted CA
- No unencrypted internal traffic — even within the Docker network

### 7. Security Headers

Every response includes hardened browser security headers:
- `Strict-Transport-Security` (HSTS)
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection`
- `Content-Security-Policy`
- `Referrer-Policy`

---

## 📊 Admin Dashboard

The Mission Control dashboard provides operators with real-time visibility into the gateway:

| Feature | Description |
|---------|-------------|
| **Overview** | Live request counts, error rates, top-hit paths, active session count |
| **Live Traffic** | Real-time audit log stream with filtering by email, path, method, status |
| **Sessions** | List all active sessions, kill individual sessions or revoke all sessions for a user |
| **Users** | Manage user accounts and role assignments |
| **Policies** | Create/delete RBAC route policies with a "what-if" simulation sandbox |
| **Device Posture** | Add/remove IP blocklist and User-Agent regex rules |

### RBAC Sandbox

The policy simulator lets admins test access decisions before deploying:

> *"If a user with roles `[hr, user]` tries to access `/api/admin/settings`, what happens?"*
>
> → **DENIED** — requires `admin` role

This prevents accidental lockouts or privilege escalation from misconfigured policies.

---

## 🚀 Quick Start

### Prerequisites

- Docker & Docker Compose
- Google OAuth 2.0 credentials (for production SSO)

### 1. Clone the Repository

```bash
git clone https://github.com/noob-master-cell/Gatekeeper.git
cd Gatekeeper
```

### 2. Start All Services (Development Mode)

```bash
cd infra
docker compose up --build -d
```

This starts all 5 services with development defaults:
- **Dashboard**: http://localhost:3000
- **Proxy**: http://localhost:8000
- **Backend**: http://localhost:8001
- **Control Plane**: http://localhost:8002

### 3. Login (Dev Mode)

In development mode, use the dev login bypass:

```bash
curl -X POST http://localhost:8000/auth/dev-login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@test.local", "roles": ["admin"]}'
```

This returns a JWT cookie you can use to access the dashboard and all admin endpoints.

### 4. Access the Dashboard

Open http://localhost:3000 — you'll see the login screen. In dev mode, the dev-login endpoint provides instant access.

---

## ☁️ Production Deployment (Railway)

### 1. Deploy Services

Push to GitHub and connect each service directory as a separate Railway service:
- `gatekeeper-proxy` → Proxy service
- `gatekeeper-control-plane` → Control Plane service
- `gatekeeper-dashboard` → Dashboard service
- Add a **Redis** instance and **PostgreSQL** instance from Railway's marketplace

### 2. Configure Environment Variables

**Proxy service:**
```env
GK_REDIS_URL=redis://default:password@redis.railway.internal:6379
GK_CONTROL_PLANE_URL=http://control-plane.railway.internal:8000
GK_BACKEND_URL=http://backend.railway.internal:8001
GK_GOOGLE_CLIENT_ID=your-google-client-id
GK_GOOGLE_CLIENT_SECRET=your-google-client-secret
GK_GOOGLE_REDIRECT_URI=https://your-proxy-domain.up.railway.app/oauth/callback
GK_DEV_MODE=false
PORT=8000
```

**Dashboard service:**
```env
PROXY_URL=http://proxy.railway.internal:8000
```

**Control Plane service:**
```env
GK_CP_DATABASE_URL=postgresql://user:pass@postgres.railway.internal:5432/gatekeeper
GK_CP_REDIS_URL=redis://default:password@redis.railway.internal:6379
```

### 3. Enable Private Networking

On each Railway service, enable **Private Networking** in Settings → Networking to allow inter-service communication.

---

## 📁 Project Structure

```
Gatekeeper/
├── gatekeeper-proxy/          # 🛡️ The reverse proxy gateway
│   ├── app/
│   │   ├── auth/              # OAuth, JWT, RBAC, sessions
│   │   │   ├── oauth.py       # Google OAuth 2.0 flow
│   │   │   ├── tokens.py      # RS256 JWT issuance & verification
│   │   │   ├── sessions.py    # Redis session CRUD
│   │   │   ├── rbac.py        # Route-level RBAC engine
│   │   │   └── keys.py        # RSA key management
│   │   ├── middleware/         # Request pipeline
│   │   │   ├── auth.py        # JWT + session + RBAC enforcement
│   │   │   ├── posture.py     # Device posture checks
│   │   │   ├── ratelimit.py   # Token-bucket rate limiting
│   │   │   ├── csrf.py        # CSRF protection
│   │   │   ├── metrics.py     # Request counting
│   │   │   ├── correlation.py # Correlation ID injection
│   │   │   ├── logging.py     # Structured request logging
│   │   │   └── security_headers.py
│   │   ├── proxy.py           # Core forwarding engine (httpx)
│   │   ├── mtls.py            # mTLS certificate management
│   │   ├── config.py          # Environment-based configuration
│   │   └── main.py            # FastAPI app + middleware stack
│   └── Dockerfile
│
├── gatekeeper-control-plane/  # 🎛️ Policy & user management API
│   ├── app/
│   │   ├── models/            # SQLAlchemy ORM models
│   │   ├── schemas/           # Pydantic request/response schemas
│   │   ├── services/          # Business logic layer
│   │   ├── routers/           # API endpoint definitions
│   │   └── main.py            # FastAPI app
│   └── Dockerfile
│
├── gatekeeper-dashboard/      # 📊 React admin dashboard
│   ├── src/
│   │   ├── components/ui/     # Reusable UI components
│   │   ├── App.tsx            # Auth-gated main application
│   │   ├── api.ts             # API client layer
│   │   ├── OverviewView.tsx   # Dashboard overview
│   │   ├── TrafficView.tsx    # Live audit log viewer
│   │   ├── SessionsView.tsx   # Session management
│   │   ├── PoliciesView.tsx   # RBAC policy editor + sandbox
│   │   └── PostureView.tsx    # Device posture rules
│   └── Dockerfile
│
├── gatekeeper-backend/        # ⚙️ Sample protected backend
│   └── Dockerfile
│
├── infra/                     # 🐳 Docker Compose orchestration
│   ├── docker-compose.yml     # Development environment
│   └── docker-compose.prod.yml # Production environment
│
└── Makefile                   # Common commands
```

---

## 🔧 Middleware Pipeline

Every request passes through this ordered middleware stack (outermost runs first):

```
Request In
    │
    ▼
┌─────────────────────┐
│  Security Headers   │  ← Adds HSTS, CSP, X-Frame-Options
├─────────────────────┤
│  CORS               │  ← Handles preflight + cross-origin
├─────────────────────┤
│  Correlation ID     │  ← Assigns unique request ID (UUID4)
├─────────────────────┤
│  Request Logging    │  ← Structured log with timing
├─────────────────────┤
│  Rate Limiting      │  ← Token-bucket per IP (20 req/min)
├─────────────────────┤
│  Metrics            │  ← Counts success/blocked/errors
├─────────────────────┤
│  CSRF Protection    │  ← Validates state tokens
├─────────────────────┤
│  Device Posture     │  ← IP blocklist + UA regex checks
├─────────────────────┤
│  Authentication     │  ← JWT verify + Redis session + RBAC
└─────────────────────┘
    │
    ▼
  Backend
```

---

## 🌍 Real-World Use Cases

### 1. Protect Internal Admin Panels
> *"We have an internal Django admin panel. Only the DevOps team should access it."*

Put it behind Gatekeeper, assign the DevOps team the `admin` role, and create a policy: `^/api/admin(/.*)?$ → [admin]`. Anyone else gets a 403.

### 2. Replace Your VPN
> *"Our engineers use a VPN to access staging servers. It's slow and unreliable."*

Deploy Gatekeeper in front of your staging environment. Engineers authenticate with their Google accounts — no VPN client needed. Works from any network, any device.

### 3. Multi-Tenant API Gateway
> *"We have HR, Finance, and Engineering APIs. Each team should only access their own."*

Create role-based policies:
- `/api/hr/*` → `[hr, admin]`
- `/api/finance/*` → `[finance, admin]`
- `/api/engineering/*` → `[engineering, admin]`

### 4. Compliance & Audit Trail
> *"Our auditors need a log of every access to sensitive endpoints."*

Gatekeeper automatically logs every request with user email, roles, path, status code, IP, and timing to a Redis Stream. Export or query the audit log at any time.

### 5. Emergency Access Revocation
> *"An employee's laptop was stolen. We need to kill all their sessions immediately."*

Open the dashboard → Sessions → click "Revoke All" for that user. Every session is destroyed in Redis instantly — their JWT becomes invalid on the next request.

---

## 🛠️ Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Proxy** | Python 3.11, FastAPI, httpx | Async-native, connection-pooled forwarding with streaming support |
| **Auth** | Google OAuth 2.0, PyJWT (RS256) | Enterprise SSO with asymmetric JWT for zero-trust token verification |
| **Sessions** | Redis 7 | Sub-millisecond session lookups with instant revocation via key deletion |
| **Policies** | PostgreSQL 16, SQLAlchemy | ACID-compliant policy storage with ORM-level constraints |
| **Dashboard** | React 18, TypeScript, Recharts | Type-safe admin UI with real-time data visualization |
| **Infrastructure** | Docker Compose, Nginx | Reproducible multi-service orchestration with load balancing |
| **Deployment** | Railway | Scalable cloud deployment with private networking |

---

<p align="center">
  <strong>Gatekeeper</strong> — Because "trust but verify" isn't enough.<br/>
  <em>Verify everything. Trust nothing. Log it all.</em>
</p>
