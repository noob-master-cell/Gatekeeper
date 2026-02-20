"""SQLAlchemy database models for the Gatekeeper control plane.

Tables:
- users: Core user identity (email, Google ID)
- roles: Named roles (admin, hr, user, etc.)
- user_roles: Many-to-many association between users and roles
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Table
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
    roles: Mapped[list[Role]] = relationship("Role", secondary=user_roles, back_populates="users")

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
    users: Mapped[list[User]] = relationship("User", secondary=user_roles, back_populates="roles")

    def __repr__(self) -> str:
        return f"<Role(id={self.id}, name='{self.name}')>"


# ─── Seed data ────────────────────────────────────────────────

SEED_ROLES = ["admin", "hr", "user"]
