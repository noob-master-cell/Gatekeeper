"""SQLAlchemy database models for the Gatekeeper control plane.

Tables:
- users: Core user identity (email, Google ID)
- roles: Named roles (admin, hr, user, etc.)
- user_roles: Many-to-many association between users and roles
- route_policies: Dynamic RBAC route definitions
- policy_roles: Many-to-many between policies and roles
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Table
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """Base class for all models."""

    pass


# ─── Association table ────────────────────────────────────────

user_roles = Table(
    "user_roles",
    Base.metadata,
    Column("user_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("role_id", Integer, ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
)

policy_roles = Table(
    "policy_roles",
    Base.metadata,
    Column("policy_id", Integer, ForeignKey("route_policies.id", ondelete="CASCADE"), primary_key=True),
    Column("role_id", Integer, ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
)


# ─── User model ──────────────────────────────────────────────


class User(Base):
    """A Gatekeeper user — created on first OAuth login."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    google_id: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    roles: Mapped[list[Role]] = relationship("Role", secondary=user_roles, back_populates="users", lazy="selectin")

    def __repr__(self) -> str:
        return f"<User(id={self.id}, email='{self.email}')>"

    def role_names(self) -> list[str]:
        """Return a list of role name strings."""
        return [r.name for r in self.roles]


# ─── Role model ──────────────────────────────────────────────


class Role(Base):
    """A named role (admin, hr, user, etc.)."""

    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)

    # Relationships
    users: Mapped[list[User]] = relationship("User", secondary=user_roles, back_populates="roles", lazy="selectin")
    policies: Mapped[list["RoutePolicy"]] = relationship("RoutePolicy", secondary=policy_roles, back_populates="roles", lazy="selectin")

    def __repr__(self) -> str:
        return f"<Role(id={self.id}, name='{self.name}')>"


# ─── Route Policy model ─────────────────────────────────────


class RoutePolicy(Base):
    """Dynamic RBAC route policy."""

    __tablename__ = "route_policies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    pattern: Mapped[str] = mapped_column(String(255), nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=100, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_any_authenticated: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )

    # Relationships
    roles: Mapped[list[Role]] = relationship("Role", secondary=policy_roles, back_populates="policies", lazy="selectin")

    def __repr__(self) -> str:
        return f"<RoutePolicy(name='{self.name}', pattern='{self.pattern}')>"


# ─── Device Posture model ─────────────────────────────────────


class DevicePostureRule(Base):
    """Rules for allowing or blocking clients before auth (e.g. IPs, User Agents)."""

    __tablename__ = "posture_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rule_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True) # "ip_address", "user_agent", "geo"
    value: Mapped[str] = mapped_column(String(255), nullable=False) # e.g. "12.34.56.78", "MSIE"
    action: Mapped[str] = mapped_column(String(20), default="block") # "block", "allow"
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )

    def __repr__(self) -> str:
        return f"<DevicePostureRule({self.rule_type}='{self.value}', action='{self.action}')>"


# ─── Audit Log model (persistent) ────────────────────────────


class AuditLog(Base):
    """Persistent audit log entry — synced from Redis stream to Postgres."""

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    stream_id: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True, index=True)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), index=True
    )
    action: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    user_email: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    user_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    method: Mapped[str | None] = mapped_column(String(10), nullable=True)
    path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    client_ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
    correlation_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    detail: Mapped[str | None] = mapped_column(String(2048), nullable=True)

    def __repr__(self) -> str:
        return f"<AuditLog(id={self.id}, action='{self.action}', user='{self.user_email}')>"

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "stream_id": self.stream_id,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "action": self.action,
            "user_email": self.user_email,
            "user_id": self.user_id,
            "method": self.method,
            "path": self.path,
            "status_code": self.status_code,
            "client_ip": self.client_ip,
            "correlation_id": self.correlation_id,
            "detail": self.detail,
        }


# ─── Seed data ────────────────────────────────────────────────

SEED_ROLES = ["admin", "hr", "user"]

