"""Tests for RBAC engine and Redis session management."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.auth.keys import initialize_keys
from app.auth.rbac import ANY_AUTHENTICATED, check_route_access, get_required_roles
from app.auth.tokens import create_access_token

# ─── RBAC Engine Tests ──────────────────────────────────────────


class TestRBACEngine:
    """Test the route-level RBAC policy engine."""

    def test_admin_route_requires_admin_role(self):
        """Admin routes should require the 'admin' role."""
        allowed, reason = check_route_access("/api/admin/users", ["admin"])
        assert allowed is True
        assert "admin" in reason

    def test_admin_route_rejects_non_admin(self):
        """Admin routes should reject non-admin users."""
        allowed, reason = check_route_access("/api/admin/users", ["user"])
        assert allowed is False
        assert "requires_one_of" in reason

    def test_admin_route_rejects_hr_role(self):
        """Admin routes should reject HR role."""
        allowed, reason = check_route_access("/api/admin/dashboard", ["hr"])
        assert allowed is False

    def test_hr_route_allows_hr_role(self):
        """HR routes should allow the 'hr' role."""
        allowed, reason = check_route_access("/api/hr/employees", ["hr"])
        assert allowed is True

    def test_hr_route_allows_admin_role(self):
        """HR routes should also allow the 'admin' role."""
        allowed, reason = check_route_access("/api/hr/employees", ["admin"])
        assert allowed is True

    def test_hr_route_rejects_user_role(self):
        """HR routes should reject the 'user' role."""
        allowed, reason = check_route_access("/api/hr/employees", ["user"])
        assert allowed is False

    def test_default_route_allows_any_authenticated(self):
        """Non-admin/HR routes should allow any authenticated user."""
        allowed, reason = check_route_access("/api/public/data", ["user"])
        assert allowed is True
        assert reason == "any_authenticated"

    def test_default_route_allows_hr(self):
        """Non-admin/HR routes should allow HR users."""
        allowed, reason = check_route_access("/some/random/path", ["hr"])
        assert allowed is True

    def test_get_required_roles_admin(self):
        """Should return admin roles for admin routes."""
        roles = get_required_roles("/api/admin/users")
        assert isinstance(roles, list)
        assert "admin" in roles

    def test_get_required_roles_hr(self):
        """Should return hr/admin roles for HR routes."""
        roles = get_required_roles("/api/hr/employees")
        assert isinstance(roles, list)
        assert "hr" in roles
        assert "admin" in roles

    def test_get_required_roles_default(self):
        """Should return ANY_AUTHENTICATED for default routes."""
        roles = get_required_roles("/api/public")
        assert roles == ANY_AUTHENTICATED

    def test_multiple_user_roles(self):
        """User with multiple roles should pass if any role matches."""
        allowed, _ = check_route_access("/api/hr/employees", ["user", "hr"])
        assert allowed is True

    def test_nested_admin_path(self):
        """Deeply nested admin paths should be protected."""
        allowed, _ = check_route_access("/api/admin/deep/nested/path", ["user"])
        assert allowed is False

    def test_admin_root(self):
        """The /admin root path should be protected."""
        allowed, _ = check_route_access("/admin", ["admin"])
        assert allowed is True

    def test_admin_root_rejected_for_user(self):
        """The /admin root path should reject regular users."""
        allowed, _ = check_route_access("/admin/sessions", ["user"])
        assert allowed is False


# ─── Redis Session Tests (with mocks) ────────────────────────


class TestSessionsWithMock:
    """Test Redis session operations using mocked Redis."""

    @pytest.fixture
    def mock_redis(self):
        """Create a mock Redis client."""
        mock = AsyncMock()
        mock.setex = AsyncMock()
        mock.sadd = AsyncMock()
        mock.expire = AsyncMock()
        mock.get = AsyncMock(return_value=None)
        mock.delete = AsyncMock(return_value=1)
        mock.smembers = AsyncMock(return_value=set())
        mock.pipeline = MagicMock()
        return mock

    @pytest.mark.asyncio
    async def test_create_session(self, mock_redis):
        """Should store session data in Redis."""
        with patch("app.auth.sessions._redis_client", mock_redis):
            from app.auth.sessions import create_session

            await create_session(
                jti="test-jti-123",
                user_id="user-456",
                email="test@example.com",
                roles=["user", "hr"],
                ttl_seconds=3600,
            )

            mock_redis.setex.assert_called_once()
            call_args = mock_redis.setex.call_args
            assert call_args[0][0] == "session:test-jti-123"
            assert call_args[0][1] == 3600
            # Verify the stored data
            stored_data = json.loads(call_args[0][2])
            assert stored_data["user_id"] == "user-456"
            assert stored_data["email"] == "test@example.com"
            assert stored_data["roles"] == ["user", "hr"]

    @pytest.mark.asyncio
    async def test_get_session_found(self, mock_redis):
        """Should return session data when found."""
        session_data = json.dumps(
            {
                "user_id": "user-456",
                "email": "test@example.com",
                "roles": ["user"],
                "created_at": "2026-01-01T00:00:00Z",
            }
        )
        mock_redis.get = AsyncMock(return_value=session_data)

        with patch("app.auth.sessions._redis_client", mock_redis):
            from app.auth.sessions import get_session

            result = await get_session("test-jti-123")
            assert result is not None
            assert result["user_id"] == "user-456"
            assert result["email"] == "test@example.com"

    @pytest.mark.asyncio
    async def test_get_session_not_found(self, mock_redis):
        """Should return None for expired/revoked sessions."""
        mock_redis.get = AsyncMock(return_value=None)

        with patch("app.auth.sessions._redis_client", mock_redis):
            from app.auth.sessions import get_session

            result = await get_session("nonexistent-jti")
            assert result is None

    @pytest.mark.asyncio
    async def test_revoke_session(self, mock_redis):
        """Should delete session from Redis."""
        mock_redis.delete = AsyncMock(return_value=1)

        with patch("app.auth.sessions._redis_client", mock_redis):
            from app.auth.sessions import revoke_session

            result = await revoke_session("test-jti-123")
            assert result is True
            mock_redis.delete.assert_called_once_with("session:test-jti-123")

    @pytest.mark.asyncio
    async def test_revoke_nonexistent_session(self, mock_redis):
        """Should return False for nonexistent session."""
        mock_redis.delete = AsyncMock(return_value=0)

        with patch("app.auth.sessions._redis_client", mock_redis):
            from app.auth.sessions import revoke_session

            result = await revoke_session("nonexistent-jti")
            assert result is False

    @pytest.mark.asyncio
    async def test_revoke_all_user_sessions(self, mock_redis):
        """Should revoke all sessions for a user."""
        mock_redis.smembers = AsyncMock(return_value={"jti-1", "jti-2", "jti-3"})
        mock_pipeline = AsyncMock()
        mock_pipeline.delete = MagicMock()
        mock_pipeline.execute = AsyncMock(return_value=[1, 1, 1, 1])
        mock_redis.pipeline = MagicMock(return_value=mock_pipeline)

        with patch("app.auth.sessions._redis_client", mock_redis):
            from app.auth.sessions import revoke_all_user_sessions

            count = await revoke_all_user_sessions("user-456")
            assert count == 3

    @pytest.mark.asyncio
    async def test_get_session_roles(self, mock_redis):
        """Should return just the roles for a session."""
        session_data = json.dumps(
            {
                "user_id": "user-456",
                "email": "test@example.com",
                "roles": ["admin", "hr"],
                "created_at": "2026-01-01T00:00:00Z",
            }
        )
        mock_redis.get = AsyncMock(return_value=session_data)

        with patch("app.auth.sessions._redis_client", mock_redis):
            from app.auth.sessions import get_session_roles

            roles = await get_session_roles("test-jti-123")
            assert roles == ["admin", "hr"]


# ─── Middleware RBAC Integration Tests ────────────────────────


@pytest.fixture(autouse=True)
def setup_keys():
    """Ensure RSA keys are initialized before every test."""
    initialize_keys()


@pytest.fixture
async def client():
    """Create an async test client."""
    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_admin_route_forbidden_for_user_role(client: AsyncClient):
    """User with 'user' role should get 403 on /api/admin/*."""
    # Mock Redis to return a valid session with 'user' role
    mock_session = json.dumps(
        {
            "user_id": "test-user",
            "email": "user@test.com",
            "roles": ["user"],
            "created_at": "2026-01-01T00:00:00Z",
        }
    )

    token = create_access_token(user_id="test-user", email="user@test.com", roles=["user"])

    with patch("app.middleware.auth.get_session", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = json.loads(mock_session)
        response = await client.get(
            "/api/admin/users",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        )
    assert response.status_code == 403
    assert "Forbidden" in response.json()["error"]


@pytest.mark.asyncio
async def test_admin_route_allowed_for_admin_role(client: AsyncClient):
    """User with 'admin' role should access /api/admin/*."""
    mock_session = json.dumps(
        {
            "user_id": "admin-user",
            "email": "admin@test.com",
            "roles": ["admin"],
            "created_at": "2026-01-01T00:00:00Z",
        }
    )

    token = create_access_token(user_id="admin-user", email="admin@test.com", roles=["admin"])

    with patch("app.middleware.auth.get_session", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = json.loads(mock_session)
        response = await client.get(
            "/admin/sessions",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        )
    # Should get through to the route (may return error because Redis isn't actually running,
    # but it should NOT be 401 or 403)
    assert response.status_code != 401
    assert response.status_code != 403


@pytest.mark.asyncio
async def test_hr_route_forbidden_for_user_role(client: AsyncClient):
    """User with 'user' role should get 403 on /api/hr/*."""
    mock_session = json.dumps(
        {
            "user_id": "test-user",
            "email": "user@test.com",
            "roles": ["user"],
            "created_at": "2026-01-01T00:00:00Z",
        }
    )

    token = create_access_token(user_id="test-user", email="user@test.com", roles=["user"])

    with patch("app.middleware.auth.get_session", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = json.loads(mock_session)
        response = await client.get(
            "/api/hr/employees",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_hr_route_allowed_for_hr_role(client: AsyncClient):
    """User with 'hr' role should access /api/hr/*."""
    mock_session = json.dumps(
        {
            "user_id": "hr-user",
            "email": "hr@test.com",
            "roles": ["hr"],
            "created_at": "2026-01-01T00:00:00Z",
        }
    )

    token = create_access_token(user_id="hr-user", email="hr@test.com", roles=["hr"])

    with patch("app.middleware.auth.get_session", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = json.loads(mock_session)
        response = await client.get(
            "/api/hr/employees",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        )
    # Should pass RBAC (502 because backend isn't running)
    assert response.status_code == 502


@pytest.mark.asyncio
async def test_revoked_session_returns_401(client: AsyncClient):
    """After session revocation, the token should fail with 401."""
    token = create_access_token(user_id="test-user", email="user@test.com", roles=["user"])

    # Mock Redis returning None (session revoked)
    with patch("app.middleware.auth.get_session", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = None
        response = await client.get(
            "/some/route",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        )
    assert response.status_code == 401
    assert "revoked" in response.json()["error"].lower()


@pytest.mark.asyncio
async def test_redis_down_returns_503(client: AsyncClient):
    """When Redis is down, middleware should fail closed with 503."""
    token = create_access_token(user_id="test-user", email="user@test.com", roles=["user"])

    with patch("app.middleware.auth.get_session", new_callable=AsyncMock) as mock_get:
        mock_get.side_effect = ConnectionError("Redis connection refused")
        response = await client.get(
            "/some/route",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        )
    assert response.status_code == 503
    assert "unavailable" in response.json()["error"].lower()
