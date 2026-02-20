"""RSA key management for JWT signing and verification.

Generates an RSA key pair on startup (or loads from disk) and exposes
JWKS-compatible public key metadata.
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path

import structlog
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

logger = structlog.get_logger()

# ─── Key storage ──────────────────────────────────────────────

_KEYS_DIR = Path(os.environ.get("GK_KEYS_DIR", "/tmp/gatekeeper_keys"))
_PRIVATE_KEY_PATH = _KEYS_DIR / "private.pem"
_PUBLIC_KEY_PATH = _KEYS_DIR / "public.pem"
_KID_PATH = _KEYS_DIR / "kid.txt"

_private_key: rsa.RSAPrivateKey | None = None
_public_key: rsa.RSAPublicKey | None = None
_kid: str = ""


def _generate_key_pair() -> tuple[rsa.RSAPrivateKey, rsa.RSAPublicKey, str]:
    """Generate a new RSA-2048 key pair and save to disk."""
    _KEYS_DIR.mkdir(parents=True, exist_ok=True)

    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_key = private_key.public_key()
    kid = str(uuid.uuid4())[:8]

    # Save private key
    _PRIVATE_KEY_PATH.write_bytes(
        private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )

    # Save public key
    _PUBLIC_KEY_PATH.write_bytes(
        public_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
    )

    # Save key ID
    _KID_PATH.write_text(kid)

    logger.info("auth.keys.generated", kid=kid)
    return private_key, public_key, kid


def _load_key_pair() -> tuple[rsa.RSAPrivateKey, rsa.RSAPublicKey, str]:
    """Load existing RSA key pair from disk."""
    private_key = serialization.load_pem_private_key(
        _PRIVATE_KEY_PATH.read_bytes(),
        password=None,
    )
    public_key = private_key.public_key()
    kid = _KID_PATH.read_text().strip()

    logger.info("auth.keys.loaded", kid=kid)
    return private_key, public_key, kid  # type: ignore[return-value]


def initialize_keys() -> None:
    """Initialize keys — load from disk or generate new ones."""
    global _private_key, _public_key, _kid  # noqa: PLW0603

    if _PRIVATE_KEY_PATH.exists() and _PUBLIC_KEY_PATH.exists() and _KID_PATH.exists():
        _private_key, _public_key, _kid = _load_key_pair()
    else:
        _private_key, _public_key, _kid = _generate_key_pair()


def get_private_key() -> rsa.RSAPrivateKey:
    """Return the private key for signing."""
    if _private_key is None:
        initialize_keys()
    return _private_key  # type: ignore[return-value]


def get_public_key() -> rsa.RSAPublicKey:
    """Return the public key for verification."""
    if _public_key is None:
        initialize_keys()
    return _public_key  # type: ignore[return-value]


def get_kid() -> str:
    """Return the current key ID."""
    if not _kid:
        initialize_keys()
    return _kid


def get_public_key_pem() -> str:
    """Return the public key as PEM string."""
    pub = get_public_key()
    return pub.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()


def get_jwks() -> dict:
    """Return JWKS-compatible JSON with the current public key."""
    pub = get_public_key()
    numbers = pub.public_numbers()

    # Convert to base64url-encoded integers
    import base64

    def _int_to_base64url(n: int, length: int | None = None) -> str:
        byte_length = length or (n.bit_length() + 7) // 8
        return base64.urlsafe_b64encode(n.to_bytes(byte_length, "big")).rstrip(b"=").decode()

    return {
        "keys": [
            {
                "kty": "RSA",
                "use": "sig",
                "alg": "RS256",
                "kid": get_kid(),
                "n": _int_to_base64url(numbers.n, 256),
                "e": _int_to_base64url(numbers.e, 3),
            }
        ]
    }
