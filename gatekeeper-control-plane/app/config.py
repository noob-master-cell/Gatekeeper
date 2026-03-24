"""Control plane configuration."""

from __future__ import annotations

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Control plane settings — configurable via environment variables."""

    # Database
    database_url: str = "postgresql+asyncpg://gatekeeper:gatekeeper_dev@localhost:5432/gatekeeper"
    db_echo: bool = False

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # Server
    host: str = "0.0.0.0"
    port: int = 8002

    # Logging
    log_level: str = "INFO"

    # Inter-service API key (required in production)
    api_key: str = ""

    # mTLS
    mtls_enabled: bool = False
    mtls_cert_dir: str = "/certs"

    model_config = {"env_prefix": "GK_CP_"}


settings = Settings()
