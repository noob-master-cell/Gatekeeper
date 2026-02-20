"""mTLS enforcement middleware for the backend service.

When enabled, the backend verifies that incoming requests carry
a valid client certificate signed by the Gatekeeper CA.
"""

from __future__ import annotations

import os
import ssl
from pathlib import Path

import structlog

logger = structlog.get_logger()


def get_backend_ssl_config() -> dict | None:
    """Get SSL config for uvicorn to enable mTLS on the backend.

    Returns:
        Dict of uvicorn SSL kwargs if mTLS is enabled, None otherwise.
    """
    mtls_enabled = os.getenv("GK_MTLS_ENABLED", "false").lower() == "true"
    if not mtls_enabled:
        return None

    cert_dir = Path(os.getenv("GK_MTLS_CERT_DIR", "/certs"))
    ca_cert = cert_dir / "ca.crt"
    server_cert = cert_dir / "server.crt"
    server_key = cert_dir / "server.key"

    missing = [str(f) for f in [ca_cert, server_cert, server_key] if not f.exists()]
    if missing:
        logger.warning("mtls.backend.certs_missing", missing=missing)
        return None

    logger.info(
        "mtls.backend.configured",
        ca=str(ca_cert),
        server_cert=str(server_cert),
    )

    return {
        "ssl_certfile": str(server_cert),
        "ssl_keyfile": str(server_key),
        "ssl_ca_certs": str(ca_cert),
        "ssl_cert_reqs": ssl.CERT_REQUIRED,
    }
