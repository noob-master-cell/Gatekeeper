# ADR-0002: Authentication Model

## Status
Accepted

## Date
2025-01-15

## Context

Gatekeeper needs to authenticate two distinct client types with different threat models:

1. **Browser clients** — user-facing, susceptible to XSS, need CSRF protection
2. **API clients / services** — programmatic, long-lived credentials, need per-key rate limits and revocation

Additionally, zero-trust requires that every session can be revoked instantly — a property that standard
stateless JWTs don't provide without a server-side check.

## Decision

Three-tier auth model:

1. **OAuth 2.0 + RS256 JWT in HttpOnly cookie** for browser clients
2. **SHA-256 hashed API keys** in `X-API-Key` header for programmatic clients
3. **Optional mTLS** for service-to-service communication

Sessions are stored in Redis (keyed by JWT `jti`) to enable instant revocation despite using JWTs.

Key details:
- RS256 (asymmetric) not HS256 (symmetric) — public key can be shared via JWKS without exposing the signing key
- HttpOnly cookie not `Authorization` header — XSS cannot exfiltrate the token from JavaScript
- RSA-2048 keys rotate every 30 days (`jwks_rotation_hours: 720`); old key stays valid during grace period
- API keys stored as `sha256(raw_key)` — the plaintext key is shown only once on creation, never stored
- API keys prefixed `gk_` for easy secret scanning recognition in CI/logs

Implementation: `gatekeeper-proxy/app/auth/tokens.py`, `sessions.py`, `api_keys.py`, `keys.py`

## Alternatives Considered

| Option | Pros | Cons |
|--------|------|------|
| **Session-only auth (no JWT)** | Simple, fully server-controlled | Redis becomes a hard dependency for every request; doesn't work for API clients |
| **PASETO tokens** | Stronger cryptographic guarantees than JWT, no algorithm confusion | Less ecosystem support; no standard JWKS equivalent; adds friction for consumers |
| **Opaque tokens** | No token content leakage | Every request requires a Redis lookup; no offline verification possible for downstream services |
| **OAuth2 + JWT (chosen)** | Standard, widely understood, offline-verifiable by downstream services, JWKS enables key rotation without consumer downtime | Requires Redis for revocation; token size larger than opaque tokens |

## Why RS256 Over HS256

HS256 uses a single shared secret — any service that can verify tokens can also forge them.
RS256 uses a private key to sign and a public key to verify. Downstream services can verify tokens
using the JWKS endpoint (`/.well-known/jwks.json`) without access to the signing key.
This matters when Gatekeeper forwards tokens to backend services that may independently verify them.

## Why HttpOnly Cookie Over Authorization Header

Tokens in `localStorage` or `sessionStorage` are readable by any JavaScript on the page (XSS exfiltration).
HttpOnly cookies are not accessible via `document.cookie` or `fetch`. CSRF is mitigated separately by
the `CSRFMiddleware` which validates the `Origin` header on all state-changing requests.

## Why Redis Sessions Despite JWT Being Stateless

Zero-trust requires immediate revocation when a user logs out, an account is compromised, or a session
is administratively terminated. Standard stateless JWTs can't be revoked before their `exp` without
a server-side blocklist. Redis provides O(1) session lookup and deletion. The trade-off is that Redis
becomes a dependency on every authenticated request — acceptable given Redis is already required for
rate limiting.

## Consequences

### Positive
- Instant session revocation via `DELETE /admin/sessions/{jti}` or bulk revoke by user ID
- JWKS key rotation is transparent to consumers — old tokens remain valid during the grace period
- API keys are safe to store in logs (only the hash is stored server-side)
- mTLS is opt-in and additive — doesn't break existing auth flows

### Negative
- Redis is a hard dependency for authenticated requests (single point of failure without Redis HA)
- No JWT refresh token flow — tokens expire after `jwt_expiry_minutes` (default 60 min) and require re-login
- CSRF protection adds a round-trip constraint: browser clients must include `Origin` header on POST/PUT/DELETE

### Mitigation
- Redis AOF persistence (`appendonly yes`) is enabled in docker-compose to survive restarts
- `jwt_expiry_minutes` is configurable; set to a longer value for lower-friction development
- CSRF is only enforced on state-changing methods; GET requests are unaffected

## References
- `gatekeeper-proxy/app/auth/tokens.py` — JWT issuance and verification
- `gatekeeper-proxy/app/auth/sessions.py` — Redis session storage and revocation
- `gatekeeper-proxy/app/auth/api_keys.py` — API key hashing and lookup
- `gatekeeper-proxy/app/auth/keys.py` — RSA key generation and JWKS rotation
- `gatekeeper-proxy/app/middleware/csrf.py` — CSRF origin validation
