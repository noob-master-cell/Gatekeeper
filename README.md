# 🛡 Gatekeeper Zero-Trust Infrastructure

> A production-grade zero-trust reverse proxy system featuring identity-aware routing, granular Role-Based Access Control (RBAC), mutual TLS (mTLS), and a real-time analytics dashboard.

---

## 🎯 The Problem Solved

Modern organizations can no longer trust network perimeters. Traditional VPNs grant blanket access to entire subnets, failing to protect internal microservices from lateral movement and offering zero granular visibility into who is accessing what.

**Gatekeeper** solves this by enforcing a **Zero-Trust architecture**. It acts as an impenetrable gateway between users and internal backend services, ensuring that:
1. **Nobody bypasses authentication.** Every request is verified via Google OAuth 2.0.
2. **Access is strictly mapped to roles.** RBAC policies intercept specific paths.
3. **Internal traffic is encrypted.** Backends only accept traffic signed by the Proxy's CA (mTLS).
4. **Every action is surveilled.** All transactions stream securely to a real-time observability dashboard.

---

## 🏗 Architecture Overview

Gatekeeper operates as a decoupling routing engine powered by 5 highly optimized containerized services:

```text
                    ┌─────────────────────────────────────────────┐
                    │            GATEKEEPER CLUSTER               │
                    │                                             │
  Browser/Client    │  ┌──────────────┐    ┌──────────────────┐   │
  ──── HTTPS ──────►│  │   PROXY      │    │    BACKEND       │   │
                    │  │  (port 8000)  │──►│   (port 8001)    │   │
                    │  │              │mTLS│                  │   │
                    │  │  • Auth Auth │    │  • Protected API │   │
                    │  │  • RBAC      │    │  • HR Services   │   │
                    │  │  • Audit Log │    │                  │   │
                    │  └──────┬───────┘    └──────────────────┘   │
                    │         │                                   │
                    │    ┌────┴────┐    ┌──────────────────┐      │
                    │    │  Redis  │    │   PostgreSQL     │      │
                    │    │ Tokens  │    │  User Identity   │      │
                    │    │ & Cache │    │  & Policies      │      │
                    │    └─────────┘    └──────────────────┘      │
                    │                                             │
                    │  ┌──────────────────────────────────────┐   │
                    │  │        MISSION CONTROL DASHBOARD     │   │
                    │  │  • Traffic Analytics • Sandbox Tools │   │
                    │  │  • Policy Management • Kill Switches │   │
                    │  └──────────────────────────────────────┘   │
                    └─────────────────────────────────────────────┘
```

### 📡 The 5 Microservices
1. **Gateway Proxy (`FastAPI`):** The primary ingress point. It evaluates JWTs, checks the blazing-fast Redis cache for RBAC compliance, and manages OAuth redirection handshakes.
2. **Control Plane (`FastAPI`):** An invisible, highly-isolated admin backbone managing PostgreSQL identities.
3. **Mission Control (`React / Nginx`):** A brutalist, "Teenage Engineering" themed frontend embedded natively on the proxy for immediate analytical oversight.
4. **PostgreSQL 16:** The absolute source of truth for all users, policies, and authorization graphs.
5. **Redis 7:** The ephemeral memory engine running the `audit:log` stream and Token Bucket Rate Limiters.

---

## 🛠 Key Features

*   **Google SSO Integration:** Cryptographically proven Google Workspace verification. No passwords, no brute force.
*   **Tactile Mission Control:** A heavily stylized React interface visualizing real-time threat blocks, top hit paths, and hyper-active identities via live cursor pagination.
*   **Global Kill Switches:** Administrators can instantly revoke all active JSON Web Tokens (JWTs) hooked to a compromised identity with a single click.
*   **RBAC Diagnostic Sandbox:** An embedded terminal UI that simulates hypothetical payload interceptions to safely test complicated permission algorithms.
*   **Aggressive Observability:** Correlation IDs tag every request, streaming directly to Redis for immediate visual rendering.
*   **Advanced Middleware:** Deep nested defenses including CSRF validation, strict `SameSite` session scoping, HSTS, and 20req/min destructive-rate limitations.

---

## 🚦 Quick Start: Local Docker

To deploy the entire infrastructure locally, simply ensure Docker is running and execute:

```bash
# 1. Clone the repository
git clone https://github.com/your-username/Gatekeeper.git
cd Gatekeeper

# 2. Start the full 5-container network
cd infra
docker compose up --build -d

# 3. Access the dashboard
# Make sure to configure your Google OAuth keys in infra/.env first!
open http://localhost:8000
```

---

## ☁️ Production Deployment

Gatekeeper cleanly abstracts into enterprise cloud providers. For hobbyists or small organizations wanting to deploy this specific Docker Compose layout permanently, the easiest route is via **Railway**:

1. Follow the **[Railway Deployment Guide](RAILWAY_DEPLOYMENT.md)** to securely deploy your databases, the private Control Plane, and expose the Public Proxy to a free `https://` domain natively!

Alternatively, spin up a basic VPS (like DigitalOcean) and use a free **Cloudflare Tunnel** to route traffic directly to port `8000` without exposing any firewall holes to the internet.

---

## 📜 License

MIT License.
