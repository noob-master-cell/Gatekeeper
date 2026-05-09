"""Shared pytest fixtures for the proxy test suite."""

from __future__ import annotations

import os

import pytest

# Enable dev mode for all tests so /auth/dev-login is available
os.environ.setdefault("GK_DEV_MODE", "true")
os.environ.setdefault("GK_DEV_LOGIN_ENABLED", "true")


@pytest.fixture(autouse=True)
async def reset_proxy_client():
    """Close the shared httpx client after each test to avoid event-loop leaks."""
    yield
    from app.proxy import close_client
    await close_client()
