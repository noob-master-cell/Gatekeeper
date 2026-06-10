"""Proxy configuration loaded from environment variables."""

from __future__ import annotations

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Proxy settings — configurable via environment variables."""

    # Backend targets
    backend_url: str = "http://localhost:8001"
    control_plane_url: str = "http://localhost:8002"

    # Proxy server
    proxy_host: str = "0.0.0.0"
    proxy_port: int = 8000
    workers: int = 2

    # Timeouts (seconds)
    backend_connect_timeout: float = 5.0
    backend_read_timeout: float = 30.0

    # Connection pool
    max_connections: int = 200
    max_keepalive_connections: int = 50

    # Logging
    log_level: str = "INFO"
    log_format: str = "console"  # "console" or "json"

    # Dev mode (defaults to False for safety — enable explicitly for local dev)
    dev_mode: bool = False

    # CORS / CSRF allowed origins
    cors_origins: str = "http://localhost:3000,http://localhost:8000,https://localhost:3000,https://localhost:8000"

    @property
    def parsed_cors_origins(self) -> list[str]:
        """Return the allowed origins as a parsed list of strings."""
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    # ─── Auth / OAuth ─────────────────────────────────────
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/auth/callback/google"

    # JWT
    jwt_expiry_minutes: int = 60
    keys_dir: str = "/tmp/gatekeeper_keys"

    # JWKS rotation
    jwks_rotation_hours: int = 720  # Rotate keys every 30 days by default

    # Dev login bypass (only works when dev_mode=True)
    dev_login_enabled: bool = True

    # Portfolio demo login — safe to leave enabled (creates read-only user session)
    demo_enabled: bool = True

    # Redis (sessions)
    redis_url: str = "redis://localhost:6379/0"

    # mTLS
    mtls_enabled: bool = False
    mtls_cert_dir: str = "/certs"

    # Control-plane API key (inter-service auth)
    cp_api_key: str = ""

    # ─── OPA (Open Policy Agent) ─────────────────────────
    opa_enabled: bool = False
    opa_url: str = "http://localhost:8181"
    opa_policy_path: str = "v1/data/gatekeeper/authz"
    opa_fail_open: bool = False  # Fail closed by default (deny on OPA error)

    # ─── Observability ───────────────────────────────────
    otel_endpoint: str = ""  # OTLP gRPC endpoint (e.g., http://otel-collector:4317)
    environment: str = "development"

    model_config = {"env_prefix": "GK_"}


settings = Settings()
