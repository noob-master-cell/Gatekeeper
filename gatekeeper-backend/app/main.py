"""Gatekeeper Backend — Dummy HR API for testing the proxy."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import structlog
from fastapi import FastAPI, Request

logger = structlog.get_logger()

app = FastAPI(
    title="Gatekeeper Backend — HR API",
    description="Dummy HR service used as backend target for the Gatekeeper proxy.",
    version="0.1.0",
)


@app.middleware("http")
async def log_requests(request: Request, call_next):  # noqa: ANN001
    """Log every incoming request with correlation ID."""
    correlation_id = request.headers.get("X-Correlation-ID", str(uuid.uuid4()))
    log = logger.bind(
        correlation_id=correlation_id,
        method=request.method,
        path=request.url.path,
    )
    log.info("backend.request.received")
    response = await call_next(request)
    log.info("backend.request.completed", status_code=response.status_code)
    response.headers["X-Correlation-ID"] = correlation_id
    return response


@app.get("/health")
async def health() -> dict:
    """Health check endpoint."""
    return {
        "status": "ok",
        "service": "gatekeeper-backend",
        "timestamp": datetime.now(UTC).isoformat(),
    }


# ─── HR Employees ────────────────────────────────────────────

EMPLOYEES = [
    {"id": 1, "name": "Alice Johnson", "department": "Engineering", "email": "alice@acme.corp"},
    {"id": 2, "name": "Bob Smith", "department": "Human Resources", "email": "bob@acme.corp"},
    {"id": 3, "name": "Carol Williams", "department": "Finance", "email": "carol@acme.corp"},
    {"id": 4, "name": "Dave Brown", "department": "Engineering", "email": "dave@acme.corp"},
    {"id": 5, "name": "Eve Davis", "department": "Marketing", "email": "eve@acme.corp"},
]


@app.get("/api/hr/employees")
async def list_employees(department: str | None = None) -> dict:
    """Return list of employees, optionally filtered by department."""
    filtered = EMPLOYEES
    if department:
        filtered = [e for e in EMPLOYEES if e["department"].lower() == department.lower()]
    return {
        "data": filtered,
        "count": len(filtered),
        "timestamp": datetime.now(UTC).isoformat(),
    }


# ─── HR Requests ─────────────────────────────────────────────

_requests_db: list[dict] = []


@app.post("/api/hr/requests")
async def create_request(request: Request) -> dict:
    """Create a new HR request."""
    body = await request.json()
    new_request = {
        "id": str(uuid.uuid4()),
        "type": body.get("type", "general"),
        "description": body.get("description", ""),
        "status": "pending",
        "created_at": datetime.now(UTC).isoformat(),
    }
    _requests_db.append(new_request)
    return {
        "data": new_request,
        "message": "Request created successfully",
    }


@app.get("/api/hr/requests")
async def list_requests() -> dict:
    """Return all HR requests."""
    return {
        "data": _requests_db,
        "count": len(_requests_db),
    }
