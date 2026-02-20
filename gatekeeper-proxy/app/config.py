"""Proxy configuration loaded from environment variables."""

from __future__ import annotations

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Proxy settings — configurable via environment variables."""

    # Backend target
    backend_url: str = "http://localhost:8001"

    # Proxy server
    proxy_host: str = "0.0.0.0"
    proxy_port: int = 8000

    # Timeouts (seconds)
    backend_connect_timeout: float = 5.0
    backend_read_timeout: float = 30.0

    # Connection pool
    max_connections: int = 100
    max_keepalive_connections: int = 20

    # Logging
    log_level: str = "INFO"

    # Dev mode
    dev_mode: bool = False

    model_config = {"env_prefix": "GK_"}


settings = Settings()
