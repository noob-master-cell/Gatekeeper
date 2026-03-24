"""Database connection and session management."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings

# Create engine — connects to PostgreSQL via asyncpg
engine = create_async_engine(
    settings.database_url,
    echo=settings.db_echo,
    pool_size=10,
    max_overflow=20,
    pool_recycle=1800,      # Recycle connections after 30 minutes
    pool_pre_ping=True,     # Validate connections before use
)

# Session factory
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncSession:  # type: ignore[misc]
    """Dependency that provides a database session."""
    async with async_session() as session:
        try:
            yield session  # type: ignore[misc]
        finally:
            await session.close()
