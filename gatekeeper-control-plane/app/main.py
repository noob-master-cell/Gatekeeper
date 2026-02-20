"""Gatekeeper Control Plane — RBAC models, migrations, and admin APIs."""

from __future__ import annotations

from datetime import UTC, datetime

import structlog
from fastapi import FastAPI

logger = structlog.get_logger()

app = FastAPI(
    title="Gatekeeper Control Plane",
    description="RBAC management, user administration, and audit log APIs.",
    version="0.1.0",
)


@app.get("/health")
async def health() -> dict:
    """Health check endpoint."""
    return {
        "status": "ok",
        "service": "gatekeeper-control-plane",
        "timestamp": datetime.now(UTC).isoformat(),
    }


# ─── Placeholder routes (will be implemented in Week 3+) ─────


@app.get("/admin/users")
async def list_users() -> dict:
    """List all users — placeholder."""
    return {"data": [], "message": "Not yet implemented. Coming in Phase 3."}


@app.get("/admin/roles")
async def list_roles() -> dict:
    """List all roles — placeholder."""
    return {
        "data": [
            {"id": 1, "name": "admin"},
            {"id": 2, "name": "hr"},
            {"id": 3, "name": "user"},
        ],
        "message": "Seed roles. Full implementation in Phase 3.",
    }
