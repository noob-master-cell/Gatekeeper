# Gatekeeper Authorization Policy
#
# Roles:
#   admin  — full access everywhere
#   hr     — read-only on /api/hr/*
#   viewer — read-only (GET/HEAD) on general /api/* routes
#   user   — read+write on general /api/* routes
#
# Special rules:
#   sensitive_paths (/admin/audit-logs, /admin/sessions/revoke, /admin/api-keys) — admin only
#   time-gated: admin destructive actions on /admin/* blocked outside business hours (Mon–Fri 08–20 UTC)
#
# Hot-reloadable: OPA watches /policies, no proxy restart needed.

package gatekeeper.authz

import rego.v1

# ─── Defaults ────────────────────────────────────────────────

default allow := false
default reason := "no_matching_rule"

# ─── Helpers ─────────────────────────────────────────────────

is_admin if "admin" in input.user.roles

is_hr if {
    some r in input.user.roles
    r in {"hr", "admin"}
}

is_viewer        if "viewer" in input.user.roles
is_authenticated if count(input.user.roles) > 0

is_read_method  if input.method in {"GET", "HEAD", "OPTIONS"}
is_write_method if input.method in {"POST", "PUT", "PATCH", "DELETE"}

is_hr_path        if startswith(input.path, "/api/hr/")
is_admin_path     if startswith(input.path, "/admin/")
is_api_admin_path if startswith(input.path, "/api/admin/")

# Paths that require admin for ANY method (including GET)
admin_only_paths := {
    "/admin/sessions/revoke",
}

# Paths that require admin for writes; authenticated users can read
sensitive_paths := {
    "/admin/audit-logs",
    "/admin/sessions/revoke",
    "/admin/api-keys",
}

blocked_ips := set()

in_business_hours if {
    hour := time.clock([time.now_ns(), "UTC"])[0]
    day  := time.weekday(time.now_ns())
    hour >= 8
    hour < 20
    day >= 1
    day <= 5
}

# ─── Computed deny conditions (used in allow rules and reasons) ───

is_blocked_ip    if input.client_ip in blocked_ips
is_time_gated    if {
    is_admin
    is_write_method
    some p in {"/admin/sessions", "/admin/sessions/revoke", "/admin/api-keys"}
    startswith(input.path, p)
    not in_business_hours
}
is_sensitive_nonadmin if {
    input.path in admin_only_paths
    not is_admin
}

is_sensitive_write_nonadmin if {
    input.path in sensitive_paths
    not is_admin
    is_write_method
}
is_hr_write_denied if {
    "hr" in input.user.roles
    not is_admin
    is_hr_path
    is_write_method
}
is_viewer_write_denied if {
    is_viewer
    not is_admin
    not is_hr
    is_write_method
}

# ─── Allow rules ─────────────────────────────────────────────

# Public paths — no auth required
allow if {
    not is_blocked_ip
    input.path in public_paths
}

# Admin — sensitive endpoints
allow if {
    not is_blocked_ip
    not is_time_gated
    is_admin
    input.path in sensitive_paths
}

# Admin — /admin/* (non-sensitive)
allow if {
    not is_blocked_ip
    not is_time_gated
    is_admin
    is_admin_path
    not (input.path in sensitive_paths)
}

# Authenticated user — read-only on /admin/* (writes and admin-only paths still blocked)
allow if {
    not is_blocked_ip
    is_authenticated
    is_admin_path
    is_read_method
    not is_sensitive_nonadmin
    not is_sensitive_write_nonadmin
}

# Admin — /api/admin/*
allow if {
    not is_blocked_ip
    is_admin
    is_api_admin_path
}

# HR — read-only on /api/hr/*
allow if {
    not is_blocked_ip
    is_hr
    is_hr_path
    is_read_method
}

# Viewer — read-only on general /api/* (not hr, not admin)
allow if {
    not is_blocked_ip
    is_viewer
    startswith(input.path, "/api/")
    not is_hr_path
    not is_api_admin_path
    is_read_method
}

# Authenticated user — general /api/* (not hr, not admin, not viewer-only)
allow if {
    not is_blocked_ip
    is_authenticated
    not is_viewer_write_denied
    startswith(input.path, "/api/")
    not is_hr_path
    not is_api_admin_path
}

# Authenticated user — non-API, non-admin paths
allow if {
    not is_blocked_ip
    is_authenticated
    not is_viewer_write_denied
    not startswith(input.path, "/api/")
    not is_admin_path
    not (input.path in public_paths)
}

# ─── Public path set ─────────────────────────────────────────

public_paths := {
    "/proxy/health",
    "/health",
    "/.well-known/jwks.json",
    "/login",
    "/auth/dev-login",
    "/auth/demo",
    "/auth/logout",
    "/oauth/callback",
    "/auth/callback/google",
}

# ─── Reason (one per decision) ───────────────────────────────

reason := "blocked_ip" if is_blocked_ip

reason := "public_path" if {
    not is_blocked_ip
    input.path in public_paths
}

reason := "outside_business_hours" if {
    not is_blocked_ip
    is_time_gated
}

reason := "sensitive_endpoint_admin_only" if {
    not is_blocked_ip
    not is_time_gated
    is_sensitive_nonadmin
}

reason := "sensitive_write_denied" if {
    not is_blocked_ip
    not is_time_gated
    not is_sensitive_nonadmin
    is_sensitive_write_nonadmin
}

reason := "hr_write_denied" if {
    not is_blocked_ip
    not is_sensitive_nonadmin
    is_hr_write_denied
}

reason := "viewer_write_denied" if {
    not is_blocked_ip
    not is_sensitive_nonadmin
    not is_hr_write_denied
    is_viewer_write_denied
}

reason := "admin_role_granted" if {
    not is_blocked_ip
    allow
    is_admin
    is_admin_path
}

reason := "admin_api_granted" if {
    not is_blocked_ip
    allow
    is_admin
    is_api_admin_path
}

reason := "hr_read_granted" if {
    not is_blocked_ip
    allow
    is_hr
    is_hr_path
}

reason := "viewer_read_granted" if {
    not is_blocked_ip
    allow
    is_viewer
    not is_admin
    not is_hr
    is_read_method
}

reason := "authenticated_user" if {
    not is_blocked_ip
    allow
    not is_admin
    not is_hr
    not is_viewer
    not (input.path in public_paths)
}

reason := "unauthenticated" if {
    not is_blocked_ip
    not allow
    not is_authenticated
    not (input.path in public_paths)
}

reason := "insufficient_roles" if {
    not is_blocked_ip
    not allow
    is_authenticated
    not is_time_gated
    not is_sensitive_nonadmin
    not is_hr_write_denied
    not is_viewer_write_denied
    not (input.path in public_paths)
}
