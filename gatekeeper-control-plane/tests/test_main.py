"""Tests for the Gatekeeper Control Plane."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.fixture
async def client():
    """Create an async test client."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_health(client: AsyncClient):
    """GET /health should return status ok."""
    response = await client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["service"] == "gatekeeper-control-plane"


@pytest.mark.asyncio
async def test_list_roles(client: AsyncClient):
    """GET /admin/roles should return seed roles."""
    response = await client.get("/admin/roles")
    assert response.status_code == 200
    data = response.json()
    role_names = [r["name"] for r in data["data"]]
    assert "admin" in role_names
    assert "hr" in role_names
    assert "user" in role_names
