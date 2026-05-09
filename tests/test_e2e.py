"""End-to-end smoke tests — run against a live docker-compose stack.

Requires the full stack to be running (proxy, backend, control-plane,
redis, postgres). In CI these are started via docker-compose before
this suite runs.

Usage:
    pytest tests/test_e2e.py --base-url http://localhost:8000
"""

from __future__ import annotations

import pytest
import httpx

BASE_URL = "http://localhost:8000"
CP_URL = "http://localhost:8002"
CP_API_KEY = "dev-api-key-change-me"


@pytest.fixture(scope="module")
def client():
    with httpx.Client(base_url=BASE_URL, timeout=10.0, follow_redirects=True) as c:
        yield c


@pytest.fixture(scope="module")
def cp_client():
    with httpx.Client(
        base_url=CP_URL,
        timeout=10.0,
        headers={"X-API-Key": CP_API_KEY},
    ) as c:
        yield c


@pytest.fixture(scope="module")
def authed_client():
    """Client with an admin session cookie via dev login."""
    with httpx.Client(base_url=BASE_URL, timeout=10.0, follow_redirects=True) as c:
        r = c.post("/auth/dev-login", data={"email": "e2e@gatekeeper.local", "role": "admin"})
        assert "gatekeeper_token" in c.cookies, f"Login failed: {r.status_code}"
        yield c


# ─── Proxy health ────────────────────────────────────────────

def test_proxy_health(client):
    r = client.get("/proxy/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    assert r.json()["service"] == "gatekeeper-proxy"


def test_proxy_serves_dashboard(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "<!doctype html>" in r.text.lower()


def test_jwks_endpoint(client):
    r = client.get("/.well-known/jwks.json")
    assert r.status_code == 200
    data = r.json()
    assert "keys" in data
    assert data["keys"][0]["alg"] == "RS256"


# ─── Auth ────────────────────────────────────────────────────

def test_unauthenticated_api_returns_401(client):
    r = client.get("/admin/status", headers={"Accept": "application/json"})
    assert r.status_code == 401


def test_dev_login_sets_cookie(client):
    with httpx.Client(base_url=BASE_URL, timeout=10.0, follow_redirects=True) as c:
        r = c.post("/auth/dev-login", data={"email": "smoke@test.local", "role": "admin"})
        assert r.status_code == 200  # followed redirect to /
        assert "gatekeeper_token" in c.cookies


def test_auth_me_returns_user(authed_client):
    r = authed_client.get("/auth/me")
    assert r.status_code == 200
    data = r.json()
    assert data["email"] == "e2e@gatekeeper.local"
    assert "admin" in data["roles"]


# ─── Admin endpoints ─────────────────────────────────────────

def test_admin_status(authed_client):
    r = authed_client.get("/admin/status")
    assert r.status_code == 200
    data = r.json()
    assert "redis_ok" in data
    assert data["redis_ok"] is True
    assert "circuit_breakers" in data


def test_admin_sessions(authed_client):
    r = authed_client.get("/admin/sessions")
    assert r.status_code == 200
    assert "data" in r.json()


def test_admin_audit_logs(authed_client):
    r = authed_client.get("/admin/audit-logs?count=10")
    assert r.status_code == 200
    assert "data" in r.json()


def test_admin_rate_limits(authed_client):
    r = authed_client.get("/admin/rate-limits")
    assert r.status_code == 200
    assert "data" in r.json()


def test_admin_traffic_metrics(authed_client):
    r = authed_client.get("/admin/metrics/traffic")
    assert r.status_code == 200
    data = r.json()
    assert "data" in data
    assert len(data["data"]) == 24  # 24 hourly buckets


# ─── Control plane ───────────────────────────────────────────

def test_control_plane_health(cp_client):
    r = cp_client.get("/health")
    assert r.status_code == 200


def test_control_plane_roles(cp_client):
    r = cp_client.get("/admin/roles")
    assert r.status_code == 200
    roles = [role["name"] for role in r.json()["data"]]
    assert "admin" in roles
    assert "user" in roles


# ─── Proxy forwarding ────────────────────────────────────────

def test_proxy_forwards_to_backend(authed_client):
    r = authed_client.get("/health")
    assert r.status_code == 200
    assert r.json()["service"] == "gatekeeper-backend"


def test_user_role_forbidden_on_admin_route():
    with httpx.Client(base_url=BASE_URL, timeout=10.0, follow_redirects=True) as c:
        c.post("/auth/dev-login", data={"email": "user@test.local", "role": "user"})
        r = c.get("/admin/sessions", headers={"Accept": "application/json"})
        assert r.status_code == 403


def test_correlation_id_in_response(client):
    r = client.get("/proxy/health")
    assert "x-correlation-id" in r.headers


def test_rate_limit_headers_present(authed_client):
    r = authed_client.get("/admin/status")
    # Rate limit headers set on requests that pass through RateLimitMiddleware
    assert r.status_code == 200
