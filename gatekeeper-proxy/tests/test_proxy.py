"""Unit tests for the proxy forwarding engine."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.proxy import build_forwarded_headers

# ─── Header Building Tests ────────────────────────────────────


class FakeClient:
    """Fake client object for testing."""

    def __init__(self, host: str = "192.168.1.100"):
        self.host = host


class FakeURL:
    """Fake URL object for testing."""

    def __init__(self, scheme: str = "https"):
        self.scheme = scheme


class FakeRequest:
    """Fake request object for testing header building."""

    def __init__(
        self,
        headers: dict[str, str] | None = None,
        client_host: str = "192.168.1.100",
        scheme: str = "https",
    ):
        self._headers = headers or {}
        self.client = FakeClient(client_host)
        self.url = FakeURL(scheme)

    @property
    def headers(self):
        return self._headers

    def items(self):
        return self._headers.items()


def test_build_forwarded_headers_basic():
    """Test that X-Forwarded-* headers are injected."""
    request = FakeRequest(
        headers={
            "content-type": "application/json",
            "accept": "application/json",
            "host": "original-host.com",
        }
    )
    headers = build_forwarded_headers(request)

    assert headers["X-Forwarded-For"] == "192.168.1.100"
    assert headers["X-Forwarded-Proto"] == "https"
    assert headers["X-Forwarded-Host"] == "original-host.com"
    assert "content-type" in headers
    assert "accept" in headers


def test_build_forwarded_headers_strips_hop_by_hop():
    """Test that hop-by-hop headers are stripped."""
    request = FakeRequest(
        headers={
            "connection": "keep-alive",
            "keep-alive": "timeout=5",
            "transfer-encoding": "chunked",
            "content-type": "application/json",
            "host": "localhost",
        }
    )
    headers = build_forwarded_headers(request)

    assert "connection" not in headers
    assert "keep-alive" not in headers
    assert "transfer-encoding" not in headers
    assert "content-type" in headers


def test_build_forwarded_headers_preserves_correlation_id():
    """Test that X-Correlation-ID is preserved if present."""
    request = FakeRequest(
        headers={
            "X-Correlation-ID": "test-corr-123",
            "host": "localhost",
        }
    )
    headers = build_forwarded_headers(request)
    assert headers["X-Correlation-ID"] == "test-corr-123"


# ─── Proxy Integration Tests (using ASGI transport) ───────────


@pytest.fixture
async def client():
    """Create an async test client for the proxy app."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_proxy_health(client: AsyncClient):
    """GET /proxy/health should return proxy's own health status."""
    response = await client.get("/proxy/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["service"] == "gatekeeper-proxy"


@pytest.mark.asyncio
async def test_proxy_returns_correlation_id(client: AsyncClient):
    """Proxy should generate a correlation ID if not provided."""
    response = await client.get("/proxy/health")
    assert "x-correlation-id" in response.headers


@pytest.mark.asyncio
async def test_proxy_preserves_correlation_id(client: AsyncClient):
    """Proxy should preserve the provided correlation ID."""
    response = await client.get(
        "/proxy/health",
        headers={"X-Correlation-ID": "my-custom-id-123"},
    )
    assert response.headers.get("x-correlation-id") == "my-custom-id-123"


@pytest.mark.asyncio
async def test_proxy_forward_returns_502_when_backend_down(client: AsyncClient):
    """When backend is unreachable, proxy should return 502."""
    from app.auth.keys import initialize_keys
    from app.auth.tokens import create_access_token

    initialize_keys()
    token = create_access_token(user_id="test", email="test@test.com")

    # The backend isn't running in test mode, so forwarding should fail
    response = await client.get(
        "/api/hr/employees",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 502
    data = response.json()
    assert "error" in data
