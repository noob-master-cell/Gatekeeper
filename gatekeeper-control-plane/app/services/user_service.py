"""User service — CRUD for users and roles in PostgreSQL."""

from __future__ import annotations

from datetime import UTC, datetime

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import SEED_ROLES, Role, User

logger = structlog.get_logger()


async def seed_roles(session: AsyncSession) -> None:
    """Ensure seed roles exist in the database."""
    for role_name in SEED_ROLES:
        result = await session.execute(select(Role).where(Role.name == role_name))
        if not result.scalar_one_or_none():
            session.add(Role(name=role_name))
    await session.commit()
    logger.info("db.roles_seeded", roles=SEED_ROLES)


async def upsert_user(
    session: AsyncSession,
    email: str,
    google_id: str | None = None,
    name: str | None = None,
    default_role: str = "user",
) -> User:
    """Create or update a user on login.

    - Creates the user if new (with default role)
    - Updates last_login_at on every login
    """
    result = await session.execute(
        select(User).where(User.email == email).options(selectinload(User.roles))
    )
    user = result.scalar_one_or_none()

    if user is None:
        # New user — create with default role
        user = User(
            email=email,
            google_id=google_id,
            name=name,
            created_at=datetime.now(UTC),
            last_login_at=datetime.now(UTC),
        )
        session.add(user)
        await session.flush()  # Get the user ID

        # Assign default role
        role_result = await session.execute(select(Role).where(Role.name == default_role))
        default_role_obj = role_result.scalar_one_or_none()
        if default_role_obj:
            user.roles.append(default_role_obj)

        await session.commit()
        logger.info("db.user_created", email=email, role=default_role)
    else:
        # Existing user — update login timestamp
        user.last_login_at = datetime.now(UTC)
        if google_id and not user.google_id:
            user.google_id = google_id
        if name and not user.name:
            user.name = name
        await session.commit()
        logger.info("db.user_updated", email=email)

    return user


async def get_user_by_email(session: AsyncSession, email: str) -> User | None:
    """Look up a user by email."""
    result = await session.execute(
        select(User).where(User.email == email).options(selectinload(User.roles))
    )
    return result.scalar_one_or_none()


async def get_user_roles(session: AsyncSession, email: str) -> list[str]:
    """Get a user's role names."""
    user = await get_user_by_email(session, email)
    if user is None:
        return []
    return user.role_names()


async def assign_role(session: AsyncSession, email: str, role_name: str) -> bool:
    """Assign a role to a user. Returns True if successful."""
    user = await get_user_by_email(session, email)
    if user is None:
        return False

    result = await session.execute(select(Role).where(Role.name == role_name))
    role = result.scalar_one_or_none()
    if role is None:
        return False

    if role not in user.roles:
        user.roles.append(role)
        await session.commit()
        logger.info("db.role_assigned", email=email, role=role_name)

    return True


async def remove_role(session: AsyncSession, email: str, role_name: str) -> bool:
    """Remove a role from a user. Returns True if successful."""
    user = await get_user_by_email(session, email)
    if user is None:
        return False

    result = await session.execute(select(Role).where(Role.name == role_name))
    role = result.scalar_one_or_none()
    if role is None:
        return False

    if role in user.roles:
        user.roles.remove(role)
        await session.commit()
        logger.info("db.role_removed", email=email, role=role_name)

    return True


async def list_all_users(session: AsyncSession) -> list[dict]:
    """List all users with their roles."""
    result = await session.execute(select(User).options(selectinload(User.roles)))
    users = result.scalars().all()
    return [
        {
            "id": u.id,
            "email": u.email,
            "name": u.name,
            "roles": u.role_names(),
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
        }
        for u in users
    ]


async def list_all_roles(session: AsyncSession) -> list[dict]:
    """List all roles."""
    result = await session.execute(select(Role))
    roles = result.scalars().all()
    return [{"id": r.id, "name": r.name} for r in roles]
