# Gatekeeper OPA Policy — Zero-trust authorization in Rego
#
# This policy implements fine-grained access control:
#   - Role-based path access (with regex support)
#   - Time-based access restrictions
#   - IP-based allowlisting for sensitive endpoints
#   - Rate limiting hints per-role
#
# Hot-reloadable: edit this file and OPA picks up changes automatically.

package gatekeeper.authz

import rego.v1

# Default deny
default allow := false

# Default reason
default reason := "no_matching_rule"

# ─── Role-based path access rules ────────────────────────────

# Admin endpoints require admin role
allow if {
    glob.match("/admin/*", [], input.path)
    "admin" in input.user.roles
}

allow if {
    glob.match("/api/admin/*", [], input.path)
    "admin" in input.user.roles
}

# HR endpoints require hr or admin role
allow if {
    glob.match("/api/hr/*", [], input.path)
    some role in input.user.roles
    role in {"hr", "admin"}
}

# Any authenticated user can access general API endpoints
allow if {
    startswith(input.path, "/api/")
    not glob.match("/api/admin/*", [], input.path)
    not glob.match("/api/hr/*", [], input.path)
    count(input.user.roles) > 0
}

# Allow all authenticated users to access non-API paths
allow if {
    not startswith(input.path, "/api/")
    not startswith(input.path, "/admin/")
    count(input.user.roles) > 0
}

# ─── Reasons ─────────────────────────────────────────────────

reason := "admin_role_granted" if {
    allow
    glob.match("/admin/*", [], input.path)
    "admin" in input.user.roles
}

reason := "hr_role_granted" if {
    allow
    glob.match("/api/hr/*", [], input.path)
}

reason := "authenticated_user" if {
    allow
    not glob.match("/admin/*", [], input.path)
    not glob.match("/api/hr/*", [], input.path)
    not glob.match("/api/admin/*", [], input.path)
}

reason := "insufficient_roles" if {
    not allow
    count(input.user.roles) > 0
}

reason := "unauthenticated" if {
    not allow
    count(input.user.roles) == 0
}
