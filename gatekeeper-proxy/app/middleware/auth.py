"""Authentication middleware — enforces JWT auth + API keys + Redis sessions + RBAC + OPA.

Flow:
1. Skip auth for public routes
2. Extract credentials: JWT (cookie/Bearer) or API key (X-API-Key header)
3. Verify credentials
4. Check Redis session (for JWT-based auth)
5. Check RBAC permissions for the route
6. If OPA is enabled, evaluate OPA policy
7. Attach current_user to request state
"""

from __future__ import annotations

import jwt as pyjwt
import structlog
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.auth.rbac import check_route_access
from app.auth.sessions import get_session
from app.auth.tokens import TokenClaims, verify_access_token
from app.config import settings

logger = structlog.get_logger()

# Routes that do NOT require authentication
PUBLIC_ROUTES = frozenset(
    {
        "/",
        "/login",
        "/auth/callback/google",
        "/auth/dev-login",
        "/auth/logout",
        "/proxy/health",
        "/health",
        "/metrics",
        "/.well-known/jwks.json",
    }
)

# Prefixes that do NOT require authentication
PUBLIC_PREFIXES = (
    "/static/",
    "/assets/",
    "/vite.svg",
    "/docs",
    "/openapi.json",
    "/redoc",
)


class AuthMiddleware(BaseHTTPMiddleware):
    """Middleware that verifies JWT tokens or API keys, checks sessions, and enforces RBAC + OPA.

    - Skips authentication for public routes (login, health, JWKS, etc.)
    - Reads JWT from `gatekeeper_token` cookie or `Authorization: Bearer` header
    - Reads API key from `X-API-Key` header
    - Checks Redis for session validity (revocation support)
    - Checks RBAC policies for route access
    - Evaluates OPA policies if enabled
    - On failure: returns 401/403 with login redirect info for browser flows
    """

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        path = request.url.path

        # Skip auth for public routes
        if path in PUBLIC_ROUTES or any(path.startswith(p) for p in PUBLIC_PREFIXES):
            return await call_next(request)

        # ── Try API key auth first ────────────────────────────
        api_key = request.headers.get("X-API-Key")
        if api_key:
            return await self._authenticate_api_key(request, api_key, call_next)

        # ── Try JWT auth ──────────────────────────────────────
        token = self._extract_token(request)

        if not token:
            correlation_id = getattr(request.state, "correlation_id", "unknown")
            logger.warning(
                "auth.missing_credentials",
                path=path,
                correlation_id=correlation_id,
            )
            self._track_auth_event("missing_token")
            return self._unauthorized_response(request)

        # Verify the JWT
        try:
            claims = verify_access_token(token)
        except pyjwt.ExpiredSignatureError:
            logger.warning("auth.token_expired", path=path)
            self._track_auth_event("token_expired")
            return self._unauthorized_response(request, message="Token expired")
        except pyjwt.InvalidTokenError as exc:
            logger.warning("auth.token_invalid", path=path, error=str(exc))
            self._track_auth_event("token_invalid")
            return self._unauthorized_response(request, message="Invalid token")

        # Check Redis session (if Redis is available)
        if settings.redis_url:
            try:
                session = await get_session(claims.jti)
                if session is None:
                    logger.warning("auth.session_revoked", jti=claims.jti, path=path)
                    self._track_auth_event("session_revoked")
                    return self._unauthorized_response(request, message="Session revoked")

                # Use roles from Redis (may be updated after token issuance)
                claims.roles = session.get("roles", claims.roles)
            except RuntimeError:
                # Redis not initialized (test/dev mode) — skip session check
                logger.debug("auth.redis_not_initialized", path=path)
            except Exception as exc:
                # Redis down — fail closed (strict mode)
                logger.error("auth.redis_error", error=str(exc), path=path)
                return JSONResponse(
                    status_code=503,
                    content={
                        "error": "Session service unavailable",
                        "detail": "Redis is down. Cannot verify session.",
                    },
                )

        # Check RBAC permissions (pass method for write-restriction enforcement)
        allowed, reason = check_route_access(path, claims.roles, request.method)
        if not allowed:
            logger.warning(
                "rbac.forbidden",
                path=path,
                user_roles=claims.roles,
                reason=reason,
            )
            self._track_policy_decision("rbac", "deny")
            return self._forbidden_response(request, reason=reason)
        self._track_policy_decision("rbac", "allow")

        # ── OPA policy check (if enabled) ─────────────────────
        if settings.opa_enabled:
            opa_allowed, opa_reason = await self._check_opa_policy(request, claims)
            if not opa_allowed:
                logger.warning(
                    "opa.forbidden",
                    path=path,
                    user_roles=claims.roles,
                    reason=opa_reason,
                )
                return self._forbidden_response(request, reason=f"OPA: {opa_reason}")

        # Attach user context to request
        request.state.current_user = claims
        self._track_auth_event("success")

        logger.info(
            "auth.verified",
            user_id=claims.sub,
            email=claims.email,
            roles=claims.roles,
            path=path,
        )

        return await call_next(request)

    async def _authenticate_api_key(
        self, request: Request, raw_key: str, call_next: RequestResponseEndpoint
    ) -> Response:
        """Authenticate a request using an API key."""
        # ── Bootstrap Control Plane API Key ───────────────────
        if settings.cp_api_key and raw_key == settings.cp_api_key:
            claims = TokenClaims({
                "sub": "apikey:control-plane",
                "email": "control-plane@system.local",
                "roles": ["admin"],
                "jti": "apikey:cp-master",
            })
            
            # Check RBAC
            path = request.url.path
            allowed, reason = check_route_access(path, claims.roles)
            if not allowed:
                self._track_policy_decision("rbac", "deny")
                return self._forbidden_response(request, reason=reason)
            self._track_policy_decision("rbac", "allow")

            # OPA check
            if settings.opa_enabled:
                opa_allowed, opa_reason = await self._check_opa_policy(request, claims)
                if not opa_allowed:
                    return self._forbidden_response(request, reason=f"OPA: {opa_reason}")

            request.state.current_user = claims
            self._track_auth_event("apikey_success")
            return await call_next(request)

        try:
            from app.auth.api_keys import validate_api_key

            metadata = await validate_api_key(raw_key)
            if metadata is None:
                logger.warning("auth.apikey_invalid", path=request.url.path)
                self._track_auth_event("apikey_invalid")
                return JSONResponse(
                    status_code=401,
                    content={"error": "Invalid API key"},
                )

            # Create a synthetic claims object for API key auth
            claims = TokenClaims({
                "sub": f"apikey:{metadata.get('owner', 'unknown')}",
                "email": metadata.get("owner", ""),
                "roles": metadata.get("roles", ["user"]),
                "jti": f"apikey:{metadata.get('key_prefix', '')}",
            })

            # Check RBAC
            path = request.url.path
            allowed, reason = check_route_access(path, claims.roles)
            if not allowed:
                self._track_policy_decision("rbac", "deny")
                return self._forbidden_response(request, reason=reason)
            self._track_policy_decision("rbac", "allow")

            # OPA check for API key requests too
            if settings.opa_enabled:
                opa_allowed, opa_reason = await self._check_opa_policy(request, claims)
                if not opa_allowed:
                    return self._forbidden_response(request, reason=f"OPA: {opa_reason}")

            request.state.current_user = claims
            self._track_auth_event("apikey_success")

            return await call_next(request)

        except RuntimeError:
            # Redis not initialized — can't validate API keys
            logger.warning("auth.apikey_redis_unavailable")
            return JSONResponse(
                status_code=503,
                content={"error": "API key validation unavailable"},
            )

    async def _check_opa_policy(self, request: Request, claims: TokenClaims) -> tuple[bool, str]:
        """Evaluate request against OPA policy."""
        try:
            from app.auth.opa import evaluate_policy

            client_ip = request.client.host if request.client else "unknown"
            return await evaluate_policy(
                method=request.method,
                path=request.url.path,
                user_id=claims.sub,
                email=claims.email,
                roles=claims.roles,
                client_ip=client_ip,
            )
        except Exception as exc:
            logger.error("opa.evaluation_error", error=str(exc))
            # Fail mode is handled inside evaluate_policy
            return True, "opa_error_fallback"

    def _extract_token(self, request: Request) -> str | None:
        """Extract JWT from cookie or Authorization header."""
        # Try cookie first
        token = request.cookies.get("gatekeeper_token")
        if token:
            return token

        # Try Authorization header
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            return auth_header[7:]

        return None

    def _unauthorized_response(
        self, request: Request, message: str = "Authentication required"
    ) -> Response:
        """Return 401 with appropriate format based on request type."""
        accept = request.headers.get("accept", "")
        if "text/html" in accept:
            from starlette.responses import RedirectResponse

            return RedirectResponse(url="/login", status_code=302)

        return JSONResponse(
            status_code=401,
            content={
                "error": message,
                "login_url": "/login",
            },
        )

    def _forbidden_response(
        self, request: Request, reason: str = "Insufficient permissions"
    ) -> Response:
        """Return 403 Forbidden."""
        return JSONResponse(
            status_code=403,
            content={
                "error": "Forbidden",
                "detail": reason,
            },
        )

    @staticmethod
    def _track_auth_event(event_type: str) -> None:
        """Track auth events in Prometheus metrics."""
        try:
            from app.observability.prometheus_metrics import AUTH_EVENTS
            AUTH_EVENTS.labels(event_type=event_type).inc()
        except Exception:
            pass

    @staticmethod
    def _track_policy_decision(engine: str, decision: str) -> None:
        """Track policy decisions in Prometheus metrics."""
        try:
            from app.observability.prometheus_metrics import POLICY_DECISIONS
            POLICY_DECISIONS.labels(engine=engine, decision=decision).inc()
        except Exception:
            pass
