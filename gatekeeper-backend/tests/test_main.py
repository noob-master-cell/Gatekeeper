"""Tests for the Gatekeeper Backend — Dummy HR API."""

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


# ─── Health ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_health(client: AsyncClient):
    """GET /health should return status ok."""
    response = await client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["service"] == "gatekeeper-backend"
    assert "timestamp" in data


# ─── Employees ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_employees(client: AsyncClient):
    """GET /api/hr/employees should return all employees."""
    response = await client.get("/api/hr/employees")
    assert response.status_code == 200
    data = response.json()
    assert data["count"] == 5
    assert len(data["data"]) == 5
    assert data["data"][0]["name"] == "Alice Johnson"


@pytest.mark.asyncio
async def test_list_employees_filter_by_department(client: AsyncClient):
    """GET /api/hr/employees?department=Engineering should filter results."""
    response = await client.get("/api/hr/employees?department=Engineering")
    assert response.status_code == 200
    data = response.json()
    assert data["count"] == 2
    for emp in data["data"]:
        assert emp["department"] == "Engineering"


@pytest.mark.asyncio
async def test_list_employees_filter_no_match(client: AsyncClient):
    """GET /api/hr/employees?department=Sales should return empty."""
    response = await client.get("/api/hr/employees?department=Sales")
    assert response.status_code == 200
    data = response.json()
    assert data["count"] == 0
    assert data["data"] == []


# ─── HR Requests ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_request(client: AsyncClient):
    """POST /api/hr/requests should create a new request."""
    payload = {"type": "leave", "description": "Annual leave for 2 weeks"}
    response = await client.post("/api/hr/requests", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["message"] == "Request created successfully"
    assert data["data"]["type"] == "leave"
    assert data["data"]["status"] == "pending"
    assert "id" in data["data"]


@pytest.mark.asyncio
async def test_list_requests_empty(client: AsyncClient):
    """GET /api/hr/requests should return stored requests."""
    response = await client.get("/api/hr/requests")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data["data"], list)
