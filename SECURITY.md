# Gatekeeper — Security

## Threat Model

Gatekeeper is designed to sit in front of internal services that would otherwise be accessible to anyone on the network. Its primary security goal is: **no request reaches a protected backend unless it has been authenticated, authorized, and passes all configured policy checks.**

### What Gatekeeper Protects Against

- **Unauthenticated access** — Every non-public path requires either a valid RS256 JWT (verified against the proxy's own public key) or a valid API key (SHA-256 hashed, stored in Redis). Missing credentials produce a 401; invalid credentials are rejected with no further processing.
- **Stale session / token replay after account compromise** — Sessions are stored in Redis keyed by the JWT's `jti` claim. Deleting `session:{jti}` from Redis immediately invalidates a token regardless of its expiry time. Revoking all sessions for a user deletes every key in `user_sessions:{user_id}`.
- **Privilege escalation via stale JWT roles** — Roles are read from the Redis session record on every request (`session.get("roles", claims.roles)`), not from the token. An admin can update a user's roles in the control plane; the new roles take effect on the user's next request without requiring re-login.
- **Brute-force and credential stuffing** — The auth endpoints (`/login`, `/oauth/*`, `/auth/dev-login`) are rate-limited to 10 requests per minute per IP. Admin endpoints are limited to 60 per minute. General endpoints are limited to 200 per minute. Limits are enforced in Redis.
- **Cross-site request forgery (CSRF)** — State-changing requests (`POST`, `PUT`, `DELETE`, `PATCH`) that include a `cookie` header are checked against the `Origin` or `Referer` header. Requests whose origin is not in `GK_CORS_ORIGINS` are rejected with 403. Requests using `Authorization: Bearer` (no cookie) are exempt.
- **Clickjacking and content injection** — Security headers are set on every response (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy`, `X-XSS-Protection: 1; mode=block`).
- **Unauthorized access to role-restricted paths** — RBAC policies (stored in PostgreSQL, synced to Redis, cached in-process for 30 seconds) map URL patterns to required roles. A 403 is returned before the request reaches the backend.
- **Policy bypass via OPA misconfiguration** — When `GK_OPA_ENABLED=true`, OPA runs as an independent sidecar. The proxy sends the full request context to OPA. If OPA is unreachable, the fail mode is determined by `GK_OPA_FAIL_OPEN`: `false` (default) means deny; `true` means allow with a logged warning.
- **Upstream header injection (SSRF-adjacent)** — The proxy does not blindly forward all incoming headers. Auth-sensitive headers (`Authorization`, `Cookie`, `X-API-Key`) are stripped from the OPA input's `safe_headers` filter. The proxy constructs its own forwarded-request headers.

### What Gatekeeper Does NOT Protect Against

- **DDoS at scale (L3/L4)** — Rate limiting operates at the application layer (L7) in Redis. Volumetric attacks that saturate the network or exhaust connection slots before requests reach the proxy are outside scope. Use a CDN, cloud firewall, or anycast DDoS mitigation upstream.
- **Malicious users with valid roles** — Gatekeeper enforces that a user with the `admin` role can access admin endpoints. It does not inspect request bodies for malicious payloads, SQL injection, or other application-layer attacks. Place a WAF between Gatekeeper and the internet if that is a concern.
- **Compromised Redis** — Sessions, API keys, and rate limit counters live in Redis. If Redis is compromised, an attacker can insert arbitrary sessions or delete legitimate ones. Redis should be network-isolated and password-protected in production.
- **Compromised RSA private key** — If `GK_KEYS_DIR` is readable by an attacker, they can sign arbitrary JWTs. Restrict file permissions on this directory and use a mounted `Secret` in Kubernetes.
- **Unencrypted internal traffic when mTLS is disabled** — By default, `GK_MTLS_ENABLED=false`. Traffic between the proxy and backend is plaintext on the Docker network. Enable mTLS for any environment where the internal network is not fully trusted.

## Authentication Mechanisms

### OAuth 2.0 + RS256 JWT

The primary authentication flow for human users:

1. User is redirected to Google's authorization endpoint. The proxy stores a CSRF state token.
2. Google redirects back to `GK_GOOGLE_REDIRECT_URI` with an authorization code.
3. The proxy exchanges the code for a Google `id_token`, extracts `sub` and `email`.
4. `create_access_token()` in `app/auth/tokens.py` signs a JWT with the RSA-2048 private key using algorithm `RS256`. The JWT payload includes `sub`, `email`, `roles`, `jti` (UUID4), `iat`, `exp`, and `iss: gatekeeper-proxy`.
5. The token is set as a `gatekeeper_token` cookie with `HttpOnly`, `Secure` (in production), and `SameSite=Lax` flags.
6. The session is written to Redis: `SET session:{jti} <json> EX <ttl>`.

Verification on subsequent requests: the RS256 signature is verified using the public key loaded from `GK_KEYS_DIR`. The issuer is validated to be `gatekeeper-proxy`. The `jti` is then checked against Redis.

Tokens are **not** accepted if:
- The signature does not verify (tampered or wrong key).
- The `iss` claim is not `gatekeeper-proxy`.
- The token is expired (`ExpiredSignatureError`).
- No Redis session exists for the `jti` (revoked or never created).

### API Keys

API keys are for service-to-service or programmatic access via the `X-API-Key` request header.

- Format: `gk_<64 hex chars>` (generated by `secrets.token_hex(32)`).
- Storage: only the SHA-256 hash is stored in Redis (`apikey:{sha256_hash}`). The raw key is shown once at creation and never again.
- The hash is computed in `_hash_key()` using `hashlib.sha256(raw_key.encode()).hexdigest()`.
- Each key has its own role set and per-key rate limit (default 1000 req/min, stored in metadata).
- API key requests go through the same RBAC and OPA checks as JWT-authenticated requests.
- Keys expire after `ttl_days` (default 365 days). Revocation is immediate (Redis `DEL`).

The built-in control-plane bootstrap key (`GK_CP_API_KEY`) is matched directly against the raw `X-API-Key` header value before Redis lookup. It grants `admin` roles and is used only for control plane → proxy internal calls.

### mTLS (Optional)

When `GK_MTLS_ENABLED=true`, the proxy presents `client.crt` / `client.key` to the backend and verifies the backend's certificate against `ca.crt` (all under `GK_MTLS_CERT_DIR`). This provides mutual authentication independent of the application-layer JWT. Generate certificates with `make certs` (runs `infra/generate-certs.sh`).

## CSRF Protection

`CSRFMiddleware` (`app/middleware/csrf.py`) applies to `POST`, `PUT`, `DELETE`, and `PATCH` requests that include a `cookie` header.

1. If no `Origin` header is present, it falls back to deriving the origin from `Referer`.
2. If neither is present, the request is rejected with `403 CSRF validation failed: missing Origin header`.
3. If the derived origin is not in `ALLOWED_ORIGINS` (populated from `GK_CORS_ORIGINS`), the request is rejected with `403 CSRF validation failed: invalid Origin`.

Requests using `Authorization: Bearer` (no `cookie` header) are not subject to CSRF checks — bearer-token clients cannot be CSRF'd because a cross-origin page cannot read or inject arbitrary headers via `XMLHttpRequest`.

`/oauth/callback` is explicitly exempt from CSRF checks because it originates from Google's servers.

## Security Headers

`SecurityHeadersMiddleware` (`app/middleware/security_headers.py`) appends the following headers to every response:

| Header | Value |
|---|---|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `X-XSS-Protection` | `1; mode=block` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` (production only, when `GK_DEV_MODE=false`) |

Note: `Content-Security-Policy` is present in `SecurityHeadersMiddleware` per its docstring but the current middleware implementation sets the five headers listed above. The README documents CSP; verify the current state in `app/middleware/security_headers.py` before relying on it.

## Rate Limiting

`RateLimitMiddleware` (`app/middleware/ratelimit.py`) uses Redis counters incremented per request. The counter key expires after the window, implementing a sliding window approximation.

| Tier | Matching paths | Limit | Window |
|---|---|---|---|
| Auth | `/login`, `/oauth/`, `/auth/dev-login` | 10 req | 60 s |
| Destructive | `/admin/sessions/revoke`, `/auth/logout` | 20 req | 60 s |
| Admin | `/admin/` | 60 req | 60 s |
| Default | Everything else | 200 req | 60 s |

API-key-authenticated requests use the per-key `rate_limit` value stored in Redis metadata (default 1000 req/min), keyed by `ratelimit:apikey:{sha256_hash[:16]}`.

Exempted paths (no rate limiting): `/proxy/health`, `/health`, `/metrics`, `/.well-known/jwks.json`.

When Redis is unavailable, rate limiting **fails open** (the request is allowed). This is a deliberate availability trade-off. If you require strict rate limiting under Redis failure, you must add an in-process fallback.

Responses include:
- `X-RateLimit-Limit`: maximum requests allowed in the window.
- `X-RateLimit-Remaining`: requests remaining.
- `X-RateLimit-Reset`: seconds until window resets.
- `Retry-After` (on 429 only): seconds until retry is allowed.

## OPA Policy Engine

When `GK_OPA_ENABLED=true`, every authenticated request (after RBAC passes) is also evaluated by OPA at `GK_OPA_URL/GK_OPA_POLICY_PATH`.

The input document sent to OPA:

```json
{
  "input": {
    "method": "GET",
    "path": "/api/hr/employees",
    "path_parts": ["api", "hr", "employees"],
    "user": {
      "id": "google-oauth2|123",
      "email": "alice@company.com",
      "roles": ["hr"]
    },
    "client_ip": "203.0.113.42",
    "timestamp": "2026-05-09T12:00:00Z"
  }
}
```

Sensitive headers (`Authorization`, `Cookie`, `X-API-Key`) are never included in OPA input.

The expected response shape:

```json
{
  "result": {
    "allow": true,
    "reason": "hr_role_granted"
  }
}
```

The active policy file is `policies/authz.rego`. OPA loads it at startup from the `/policies` volume mount. Changes to `authz.rego` are picked up by OPA automatically (hot-reload).

**Fail mode:** controlled by `GK_OPA_FAIL_OPEN`. The default (`false`) is fail-closed: if OPA returns a non-200, times out, or is unreachable, the request is denied. Setting `GK_OPA_FAIL_OPEN=true` allows requests through on OPA error (logged as a warning). Choose the default fail-closed behavior for production.

OPA decisions are cached in-process for 30 seconds, keyed by `{method}:{path}:{sorted_roles}`. Cache is invalidated by calling `invalidate_cache()` in `app/auth/opa.py`. The cache has a maximum size of 4096 entries.

## JWT Security

- **Algorithm**: RS256 (asymmetric). The private key signs; anyone with the public key can verify. The public key is exposed at `GET /.well-known/jwks.json`. HS256 (symmetric, shared secret) is not used and not accepted.
- **Key size**: RSA-2048.
- **Key rotation**: Every `GK_JWKS_ROTATION_HOURS` hours (default 720 = 30 days). On rotation, the previous key pair is kept as `prev_private.pem`/`prev_public.pem` and both keys are served in the JWKS endpoint. Tokens signed with the old key remain valid until they expire naturally.
- **`jti` claim**: Every token has a unique UUID4 `jti`. This is used as the Redis session key. Token revocation is implemented by deleting `session:{jti}` from Redis — the token's cryptographic signature remains valid until expiry, but the Redis check fails.
- **Issuer validation**: `verify_access_token()` validates `iss == "gatekeeper-proxy"`.
- **Expiry**: Default 60 minutes, configurable via `GK_JWT_EXPIRY_MINUTES`.

## Session Revocation

Revoking a session takes effect on the next request (no grace period):

- **Single session**: `DELETE /admin/sessions/{jti}` — deletes `session:{jti}` from Redis.
- **All sessions for a user**: `POST /admin/sessions/revoke` with `{"user_id": "..."}` — reads the `user_sessions:{user_id}` set and pipelines a `DEL` for each `session:{jti}`, then deletes the set.

Both operations are instant Redis deletes. There is no token blacklist — the Redis session key serves as the positive proof of validity. Its absence is proof of revocation.

## Audit Logging

Every request (except `/proxy/health`, `/metrics`, `/.well-known/jwks.json`) is written to the Redis stream `audit:log` by `RequestLoggingMiddleware`. Each entry is a JSON object:

```json
{
  "timestamp": "2026-05-09T12:00:00Z",
  "action": "request_proxied",
  "email": "alice@company.com",
  "roles": ["hr"],
  "method": "GET",
  "path": "/api/hr/employees",
  "status_code": 200,
  "client_ip": "203.0.113.42",
  "correlation_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "duration_ms": 34.1
}
```

The audit log is queryable via `GET /admin/audit-logs` with optional filters: `email`, `path`, `method`, `status_code`, `count`, `cursor` (for cursor-based pagination over `XREVRANGE`). The stream is unbounded; trim it manually or set a Redis `MAXLEN` if long-term retention is not needed.

Structlog JSON logs to stdout (when `GK_LOG_FORMAT=json`) include `trace_id` and `span_id` from OpenTelemetry when a trace is active, enabling correlation between audit log entries and distributed traces.

## Responsible Disclosure

To report a security vulnerability, open a GitHub Issue in this repository and apply the `security` label. Do not include exploit code or affected credentials in the public issue. A maintainer will respond within 5 business days.

## Known Limitations

- **No token revocation list for JWTs that outlive their session**: If Redis is unavailable, the session check is skipped (`RuntimeError` from `get_redis()` is caught and logged as debug). A token with a valid signature will be accepted until Redis recovers. This trades strict revocation for availability when Redis is down.
- **JWKS endpoint is unauthenticated**: `/.well-known/jwks.json` is intentionally public so that third parties can verify tokens. This is correct behavior but means an attacker can enumerate public key material.
- **OPA decision cache does not invalidate on policy push**: When `policies/authz.rego` is updated, OPA picks up the new policy immediately, but cached decisions in the proxy process persist for up to 30 seconds. Call `invalidate_cache()` in `app/auth/opa.py` programmatically or restart the proxy to flush immediately.
- **`user_sessions:{user_id}` set may contain stale JTIs**: Expired sessions are removed by Redis TTL on the `session:{jti}` key, but the corresponding entry in `user_sessions:{user_id}` is not cleaned up lazily. `revoke_all_user_sessions` will attempt to delete already-expired keys, which is safe but slightly wasteful.
- **Rate limiting uses request count, not token count**: A client that rotates IPs or uses many API keys can exceed the spirit of the rate limit. No burst protection beyond the per-IP/per-key window counter is implemented.
