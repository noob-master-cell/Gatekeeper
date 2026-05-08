"""RSA key management for JWT signing and verification.

Supports:
  - RSA-2048 key pair generation and persistence
  - JWKS-compatible public key exposure
  - Automatic key rotation based on configurable interval
  - Graceful key transition (old key remains valid during rotation window)
"""

from __future__ import annotations

import os
import time
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
_CREATED_PATH = _KEYS_DIR / "created_at.txt"

# Previous key (for rotation grace period)
_PREV_PRIVATE_KEY_PATH = _KEYS_DIR / "prev_private.pem"
_PREV_PUBLIC_KEY_PATH = _KEYS_DIR / "prev_public.pem"
_PREV_KID_PATH = _KEYS_DIR / "prev_kid.txt"

_private_key: rsa.RSAPrivateKey | None = None
_public_key: rsa.RSAPublicKey | None = None
_kid: str = ""

# Previous key pair (valid during rotation window)
_prev_public_key: rsa.RSAPublicKey | None = None
_prev_kid: str = ""


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

    # Save key ID and creation timestamp
    _KID_PATH.write_text(kid)
    _CREATED_PATH.write_text(str(int(time.time())))

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


def _should_rotate() -> bool:
    """Check if keys should be rotated based on age."""
    if not _CREATED_PATH.exists():
        return False

    try:
        from app.config import settings
        created_at = int(_CREATED_PATH.read_text().strip())
        rotation_seconds = settings.jwks_rotation_hours * 3600
        return (int(time.time()) - created_at) > rotation_seconds
    except Exception:
        return False


def _rotate_keys() -> None:
    """Rotate keys: move current → previous, generate new current."""
    global _private_key, _public_key, _kid, _prev_public_key, _prev_kid

    logger.info("auth.keys.rotating", old_kid=_kid)

    # Preserve current key as previous (for grace period)
    if _PRIVATE_KEY_PATH.exists():
        _PREV_PRIVATE_KEY_PATH.write_bytes(_PRIVATE_KEY_PATH.read_bytes())
    if _PUBLIC_KEY_PATH.exists():
        _PREV_PUBLIC_KEY_PATH.write_bytes(_PUBLIC_KEY_PATH.read_bytes())
    if _KID_PATH.exists():
        _PREV_KID_PATH.write_text(_KID_PATH.read_text())

    _prev_public_key = _public_key
    _prev_kid = _kid

    # Generate new key pair
    _private_key, _public_key, _kid = _generate_key_pair()
    logger.info("auth.keys.rotated", new_kid=_kid, old_kid=_prev_kid)


def initialize_keys() -> None:
    """Initialize keys — load from disk, generate new, or rotate if needed."""
    global _private_key, _public_key, _kid, _prev_public_key, _prev_kid

    if _PRIVATE_KEY_PATH.exists() and _PUBLIC_KEY_PATH.exists() and _KID_PATH.exists():
        _private_key, _public_key, _kid = _load_key_pair()

        # Load previous key if it exists (from a prior rotation)
        if _PREV_PUBLIC_KEY_PATH.exists() and _PREV_KID_PATH.exists():
            prev_priv = serialization.load_pem_private_key(
                _PREV_PRIVATE_KEY_PATH.read_bytes(), password=None
            )
            _prev_public_key = prev_priv.public_key()
            _prev_kid = _PREV_KID_PATH.read_text().strip()
            logger.info("auth.keys.previous_loaded", prev_kid=_prev_kid)

        # Check if rotation is needed
        if _should_rotate():
            _rotate_keys()
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
    """Return JWKS-compatible JSON with current and previous public keys.

    Both keys are included during rotation windows so that tokens signed
    with the old key remain valid until they expire.
    """
    import base64

    def _key_to_jwk(pub_key: rsa.RSAPublicKey, kid: str) -> dict:
        numbers = pub_key.public_numbers()

        def _int_to_base64url(n: int, length: int | None = None) -> str:
            byte_length = length or (n.bit_length() + 7) // 8
            return base64.urlsafe_b64encode(n.to_bytes(byte_length, "big")).rstrip(b"=").decode()

        return {
            "kty": "RSA",
            "use": "sig",
            "alg": "RS256",
            "kid": kid,
            "n": _int_to_base64url(numbers.n, 256),
            "e": _int_to_base64url(numbers.e, 3),
        }

    keys = [_key_to_jwk(get_public_key(), get_kid())]

    # Include previous key during rotation window
    if _prev_public_key and _prev_kid:
        keys.append(_key_to_jwk(_prev_public_key, _prev_kid))

    return {"keys": keys}
