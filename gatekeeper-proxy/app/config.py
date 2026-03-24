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

    # Timeouts (seconds)
    backend_connect_timeout: float = 5.0
    backend_read_timeout: float = 30.0

    # Connection pool
    max_connections: int = 200
    max_keepalive_connections: int = 50

    # Logging
    log_level: str = "INFO"

    # Dev mode (defaults to False for safety — enable explicitly for local dev)
    dev_mode: bool = False

    # ─── Auth / OAuth ─────────────────────────────────────
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/oauth/callback"

    # JWT
    jwt_expiry_minutes: int = 60
    keys_dir: str = "/tmp/gatekeeper_keys"

    # Dev login bypass (only works when dev_mode=True)
    dev_login_enabled: bool = True

    # Redis (sessions)
    redis_url: str = "redis://localhost:6379/0"

    # mTLS
    mtls_enabled: bool = False
    mtls_cert_dir: str = "/certs"

    # Control-plane API key (inter-service auth)
    cp_api_key: str = ""

    model_config = {"env_prefix": "GK_"}


settings = Settings()
