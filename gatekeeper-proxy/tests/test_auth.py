"""Tests for the authentication system — JWT tokens, keys, and middleware."""

from __future__ import annotations

from datetime import timedelta

import jwt as pyjwt
import pytest
from httpx import ASGITransport, AsyncClient

from app.auth.keys import get_jwks, get_kid, get_public_key_pem, initialize_keys
from app.auth.tokens import TokenClaims, create_access_token, verify_access_token
from app.main import app

# ─── Test fixtures ────────────────────────────────────────────


@pytest.fixture(autouse=True)
def setup_keys():
    """Ensure RSA keys are initialized before every test."""
    initialize_keys()


@pytest.fixture
async def client():
    """Create an async test client for the proxy app."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# ─── Key Management Tests ────────────────────────────────────


def test_initialize_keys():
    """Keys should be initialized without error."""
    initialize_keys()
    assert get_kid() != ""
    assert get_public_key_pem().startswith("-----BEGIN PUBLIC KEY-----")


def test_jwks_format():
    """JWKS should have the correct structure."""
    jwks = get_jwks()
    assert "keys" in jwks
    assert len(jwks["keys"]) == 1

    key = jwks["keys"][0]
    assert key["kty"] == "RSA"
    assert key["use"] == "sig"
    assert key["alg"] == "RS256"
    assert "kid" in key
    assert "n" in key
    assert "e" in key


# ─── Token Creation Tests ────────────────────────────────────


def test_create_access_token():
    """Should create a valid JWT token."""
    token = create_access_token(
        user_id="user-123",
        email="test@example.com",
        roles=["user", "hr"],
    )
    assert isinstance(token, str)
    assert len(token) > 0

    # Decode and verify claims
    claims = verify_access_token(token)
    assert claims.sub == "user-123"
    assert claims.email == "test@example.com"
    assert claims.roles == ["user", "hr"]
    assert claims.jti != ""


def test_create_access_token_default_roles():
    """Should default to ['user'] if no roles specified."""
    token = create_access_token(user_id="user-456", email="default@example.com")
    claims = verify_access_token(token)
    assert claims.roles == ["user"]


def test_token_has_kid_header():
    """Token should have a kid in the header."""
    token = create_access_token(user_id="user-789", email="kid@example.com")
    header = pyjwt.get_unverified_header(token)
    assert "kid" in header
    assert header["kid"] == get_kid()
    assert header["alg"] == "RS256"


# ─── Token Verification Tests ────────────────────────────────


def test_verify_valid_token():
    """Should verify a valid token successfully."""
    token = create_access_token(user_id="user-abc", email="valid@example.com", roles=["admin"])
    claims = verify_access_token(token)
    assert isinstance(claims, TokenClaims)
    assert claims.sub == "user-abc"
    assert claims.email == "valid@example.com"
    assert claims.roles == ["admin"]


def test_verify_expired_token():
    """Should reject an expired token."""
    token = create_access_token(
        user_id="user-exp",
        email="expired@example.com",
        expires_delta=timedelta(seconds=-1),
    )
    with pytest.raises(pyjwt.ExpiredSignatureError):
        verify_access_token(token)


def test_verify_tampered_token():
    """Should reject a token with an invalid signature."""
    token = create_access_token(user_id="user-tamper", email="tamper@example.com")
    # Tamper with the token by modifying the payload
    parts = token.split(".")
    parts[1] = parts[1] + "x"
    tampered = ".".join(parts)

    with pytest.raises(pyjwt.InvalidTokenError):
        verify_access_token(tampered)


def test_token_claims_to_dict():
    """TokenClaims.to_dict() should return serializable dict."""
    token = create_access_token(user_id="user-dict", email="dict@example.com", roles=["hr"])
    claims = verify_access_token(token)
    d = claims.to_dict()
    assert d["sub"] == "user-dict"
    assert d["email"] == "dict@example.com"
    assert d["roles"] == ["hr"]
    assert "jti" in d


# ─── Middleware Integration Tests ─────────────────────────────


@pytest.mark.asyncio
async def test_public_routes_no_auth(client: AsyncClient):
    """Public routes should not require authentication."""
    # /proxy/health is public
    response = await client.get("/proxy/health")
    assert response.status_code == 200

    # JWKS endpoint is public
    response = await client.get("/.well-known/jwks.json")
    assert response.status_code == 200

    # Login is public
    response = await client.get("/login", follow_redirects=False)
    assert response.status_code in (200, 302, 307)


@pytest.mark.asyncio
async def test_protected_route_requires_auth(client: AsyncClient):
    """Protected routes should return 401 without a token."""
    response = await client.get(
        "/api/hr/employees",
        headers={"Accept": "application/json"},
    )
    assert response.status_code == 401
    data = response.json()
    assert "error" in data
    assert "login_url" in data


@pytest.mark.asyncio
async def test_protected_route_with_valid_bearer_token(client: AsyncClient):
    """Protected routes should accept valid Bearer token."""
    token = create_access_token(user_id="test-user", email="test@example.com", roles=["user"])

    response = await client.get(
        "/api/hr/employees",
        headers={"Authorization": f"Bearer {token}"},
    )
    # Should forward to backend (502 since backend isn't running in test)
    assert response.status_code == 502


@pytest.mark.asyncio
async def test_protected_route_with_valid_cookie(client: AsyncClient):
    """Protected routes should accept valid cookie token."""
    token = create_access_token(user_id="test-user", email="test@example.com", roles=["user"])

    response = await client.get(
        "/api/hr/employees",
        cookies={"gatekeeper_token": token},
    )
    # Should forward to backend (502 since backend isn't running in test)
    assert response.status_code == 502


@pytest.mark.asyncio
async def test_protected_route_with_expired_token(client: AsyncClient):
    """Protected routes should reject expired tokens."""
    token = create_access_token(
        user_id="test-user",
        email="test@example.com",
        expires_delta=timedelta(seconds=-1),
    )

    response = await client.get(
        "/api/hr/employees",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        },
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_browser_redirect_on_auth_failure(client: AsyncClient):
    """Browser requests should be redirected to /login on auth failure."""
    response = await client.get(
        "/api/hr/employees",
        headers={"Accept": "text/html"},
        follow_redirects=False,
    )
    assert response.status_code == 302
    assert "/login" in response.headers.get("location", "")


@pytest.mark.asyncio
async def test_jwks_endpoint_content(client: AsyncClient):
    """JWKS endpoint should return valid key data."""
    response = await client.get("/.well-known/jwks.json")
    assert response.status_code == 200
    data = response.json()
    assert "keys" in data
    assert len(data["keys"]) == 1
    assert data["keys"][0]["alg"] == "RS256"


@pytest.mark.asyncio
async def test_dev_login_page(client: AsyncClient):
    """Dev login page should be available in dev mode."""
    response = await client.get("/auth/dev-login")
    assert response.status_code == 200
    assert "Dev Login" in response.text


@pytest.mark.asyncio
async def test_dev_login_submit(client: AsyncClient):
    """Dev login should issue a JWT cookie."""
    response = await client.post(
        "/auth/dev-login",
        data={"email": "dev@test.com", "role": "admin"},
        follow_redirects=False,
    )
    assert response.status_code == 302
    # Check that a cookie was set
    cookies = response.headers.get_list("set-cookie")
    assert any("gatekeeper_token" in c for c in cookies)


@pytest.mark.asyncio
async def test_auth_me_without_token(client: AsyncClient):
    """/auth/me should return 401 without authentication."""
    response = await client.get(
        "/auth/me",
        headers={"Accept": "application/json"},
    )
    # /auth/me is under /auth/ prefix which is public, but returns 401 if no user
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_logout(client: AsyncClient):
    """Logout should redirect and clear cookie."""
    response = await client.get("/auth/logout", follow_redirects=False)
    assert response.status_code == 302
    assert "/login" in response.headers.get("location", "")
