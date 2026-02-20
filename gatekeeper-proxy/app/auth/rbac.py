"""Route-level RBAC — maps routes to required roles and enforces access.

Design:
- Policy map defines which roles can access which route patterns
- Supports exact matches and prefix matches
- Default policy: any authenticated user can access unmatched routes
"""

from __future__ import annotations

import re

import structlog

logger = structlog.get_logger()


# ─── Route Policy Map ────────────────────────────────────────
# Each entry: (pattern, required_roles)
# Patterns are checked in order; first match wins.
# "ANY_AUTHENTICATED" means any valid token is sufficient.

ANY_AUTHENTICATED = "__any_authenticated__"

ROUTE_POLICIES: list[tuple[str, list[str] | str]] = [
    # Admin routes — admin only
    (r"^/api/admin(/.*)?$", ["admin"]),
    (r"^/admin(/.*)?$", ["admin"]),
    # HR routes — hr and admin
    (r"^/api/hr(/.*)?$", ["hr", "admin"]),
    # Default — any authenticated user
    (r"^/.*$", ANY_AUTHENTICATED),
]

# Compiled regex cache
_compiled_policies: list[tuple[re.Pattern, list[str] | str]] = [
    (re.compile(pattern), roles) for pattern, roles in ROUTE_POLICIES
]


def check_route_access(path: str, user_roles: list[str]) -> tuple[bool, str]:
    """Check if a user with given roles can access the specified path.

    Args:
        path: The request path (e.g., "/api/hr/employees").
        user_roles: The user's role names (e.g., ["user", "hr"]).

    Returns:
        Tuple of (allowed: bool, reason: str).
    """
    for pattern, required_roles in _compiled_policies:
        if pattern.match(path):
            if required_roles == ANY_AUTHENTICATED:
                return True, "any_authenticated"

            # Check if user has at least one of the required roles
            if isinstance(required_roles, list):
                overlap = set(user_roles) & set(required_roles)
                if overlap:
                    return True, f"role_match:{','.join(overlap)}"
                else:
                    logger.warning(
                        "rbac.denied",
                        path=path,
                        user_roles=user_roles,
                        required_roles=required_roles,
                    )
                    return False, f"requires_one_of:{','.join(required_roles)}"

    # No policy matched — allow by default (shouldn't happen with catch-all)
    return True, "no_policy_match"


def get_required_roles(path: str) -> list[str] | str:
    """Get the required roles for a path (for documentation/debugging)."""
    for pattern, required_roles in _compiled_policies:
        if pattern.match(path):
            return required_roles
    return ANY_AUTHENTICATED
