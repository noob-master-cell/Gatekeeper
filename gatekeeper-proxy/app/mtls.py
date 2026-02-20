"""mTLS configuration for the proxy's connection to the backend.

When mTLS is enabled (GK_MTLS_ENABLED=true), the proxy uses client certificates
to authenticate itself to the backend service.
"""

from __future__ import annotations

import ssl
from pathlib import Path

import structlog

from app.config import settings

logger = structlog.get_logger()


def create_mtls_ssl_context() -> ssl.SSLContext | None:
    """Create an SSL context for mTLS client authentication.

    Returns:
        SSLContext if mTLS is enabled and certs exist, None otherwise.
    """
    if not settings.mtls_enabled:
        logger.info("mtls.disabled", message="mTLS is not enabled")
        return None

    cert_dir = Path(settings.mtls_cert_dir)
    ca_cert = cert_dir / "ca.crt"
    client_cert = cert_dir / "client.crt"
    client_key = cert_dir / "client.key"

    # Check that all required files exist
    missing = [str(f) for f in [ca_cert, client_cert, client_key] if not f.exists()]
    if missing:
        logger.warning("mtls.certs_missing", missing=missing)
        return None

    ctx = ssl.create_default_context(
        purpose=ssl.Purpose.SERVER_AUTH,
        cafile=str(ca_cert),
    )
    ctx.load_cert_chain(
        certfile=str(client_cert),
        keyfile=str(client_key),
    )
    # Verify the backend's server certificate
    ctx.check_hostname = False  # We use DNS name "backend" in Docker
    ctx.verify_mode = ssl.CERT_REQUIRED

    logger.info(
        "mtls.configured",
        ca=str(ca_cert),
        client_cert=str(client_cert),
    )
    return ctx
