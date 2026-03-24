from __future__ import annotations

import json
from collections.abc import Sequence

import redis.asyncio as aioredis
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Role, RoutePolicy, DevicePostureRule

async def list_all_policies(session: AsyncSession) -> Sequence[RoutePolicy]:
    result = await session.execute(
        select(RoutePolicy).order_by(RoutePolicy.priority.asc(), RoutePolicy.id.asc())
    )
    return result.scalars().all()

async def create_or_update_policy(
    session: AsyncSession,
    name: str,
    pattern: str,
    priority: int = 100,
    is_active: bool = True,
    allow_any_authenticated: bool = False,
    description: str | None = None,
    roles: list[str] | None = None,
) -> RoutePolicy:
    # Check if exists
    result = await session.execute(
        select(RoutePolicy).where(RoutePolicy.name == name)
    )
    policy = result.scalars().first()

    if not policy:
        policy = RoutePolicy(name=name)
        session.add(policy)

    policy.pattern = pattern
    policy.priority = priority
    policy.is_active = is_active
    policy.allow_any_authenticated = allow_any_authenticated
    policy.description = description
    
    await session.commit()
    
    if roles is not None:
        # Delete existing role associations for this policy
        from app.models import policy_roles
        await session.execute(delete(policy_roles).where(policy_roles.c.policy_id == policy.id))
        
        # Insert new ones directly
        if roles:
            role_result = await session.execute(select(Role).where(Role.name.in_(roles)))
            db_roles = role_result.scalars().all()
            if db_roles:
                values = [{"policy_id": policy.id, "role_id": r.id} for r in db_roles]
                await session.execute(policy_roles.insert().values(values))
        
    # Only return the id so we don't accidentally lazy load fields later
    policy_id = policy.id
    await session.commit()
    
    # Re-fetch fully loaded for the caller
    fresh = await session.execute(
        select(RoutePolicy).where(RoutePolicy.id == policy_id)
    )
    return fresh.scalars().first()

async def delete_policy(session: AsyncSession, name: str) -> bool:
    result = await session.execute(delete(RoutePolicy).where(RoutePolicy.name == name))
    await session.commit()
    return result.rowcount > 0

async def ensure_default_policies(session: AsyncSession) -> None:
    import structlog
    logger = structlog.get_logger()
    logger.info("seed.ensuring_defaults")
    
    """Seed the database with secure default policies if it is empty."""
    
    # Just do a fast scalar check if any policy exists to avoid loading graphs
    result = await session.execute(select(RoutePolicy.id).limit(1))
    has_policy = result.scalars().first() is not None
    
    logger.info("seed.check_policies_exist", exists=has_policy)
    
    if not has_policy:
        # Create default roles if they don't exist
        logger.info("seed.creating_roles")
        from app.services.user_service import seed_roles
        await seed_roles(session)

        logger.info("seed.creating_admin_api")
        # 1. Admin API requires admin
        await create_or_update_policy(
            session=session,
            name="Admin API",
            pattern=r"^/api/admin(/.*)?$",
            priority=10,
            roles=["admin"]
        )
        
        logger.info("seed.creating_admin_ui")
        # 2. Admin UI requires admin
        await create_or_update_policy(
            session=session,
            name="Admin UI",
            pattern=r"^/admin(/.*)?$",
            priority=20,
            roles=["admin"]
        )
        
        logger.info("seed.creating_catch_all")
        # 3. Default catch-all allows any authenticated request
        await create_or_update_policy(
            session=session,
            name="Default Catch-All",
            pattern=r"^/.*$",
            priority=100,
            allow_any_authenticated=True
        )
        logger.info("seed.done")

async def sync_policies_to_redis(session: AsyncSession, redis: aioredis.Redis) -> None:
    # Explicitly fetch with roles eagerly loaded for the sync
    result = await session.execute(
        select(RoutePolicy).options(selectinload(RoutePolicy.roles))
    )
    policies = result.scalars().all()
    
    active_policies = [p for p in policies if p.is_active]
    
    # Structure: [{"pattern": "^/api/admin", "roles": ["admin"]}] or "ANY_AUTHENTICATED"
    payload = []
    for p in active_policies:
        req = "ANY_AUTHENTICATED" if p.allow_any_authenticated else [r.name for r in p.roles]
        payload.append((p.pattern, req))
        
    await redis.set("rbac:policies", json.dumps(payload))


# ─── Device Posture Functions ─────────────────────────────────

async def list_all_posture_rules(session: AsyncSession) -> Sequence[DevicePostureRule]:
    result = await session.execute(
        select(DevicePostureRule).order_by(DevicePostureRule.id.asc())
    )
    return result.scalars().all()

async def create_or_update_posture_rule(
    session: AsyncSession,
    rule_type: str,
    value: str,
    action: str = "block",
    is_active: bool = True,
    description: str | None = None,
) -> DevicePostureRule:
    result = await session.execute(
        select(DevicePostureRule).where(
            DevicePostureRule.rule_type == rule_type,
            DevicePostureRule.value == value
        )
    )
    rule = result.scalars().first()

    if not rule:
        rule = DevicePostureRule(rule_type=rule_type, value=value)
        session.add(rule)

    rule.action = action
    rule.is_active = is_active
    rule.description = description

    await session.commit()
    await session.refresh(rule)
    return rule

async def delete_posture_rule(session: AsyncSession, rule_id: int) -> bool:
    result = await session.execute(delete(DevicePostureRule).where(DevicePostureRule.id == rule_id))
    await session.commit()
    return result.rowcount > 0

async def sync_posture_to_redis(session: AsyncSession, redis: aioredis.Redis) -> None:
    rules = await list_all_posture_rules(session)
    active_rules = [r for r in rules if r.is_active]
    
    # Structure: {"ip_address": ["12.34.56.78"], "user_agent": ["MSIE", "Trident"]}
    payload: dict[str, list[str]] = {
        "ip_address": [],
        "user_agent": [],
        "geo": [],
    }
    
    for r in active_rules:
        # Currently only supporting 'block'
        if r.action == "block":
            if r.rule_type in payload:
                payload[r.rule_type].append(r.value)
            
    await redis.set("posture:rules", json.dumps(payload))
