package gatekeeper.authz_test

import data.gatekeeper.authz
import rego.v1

# Fixed timestamp inside business hours (Wed 2026-04-15 12:00 UTC).
in_hours_ns := time.parse_rfc3339_ns("2026-04-15T12:00:00Z")

# Fixed timestamp outside business hours (Sat 2026-04-18 12:00 UTC).
off_hours_ns := time.parse_rfc3339_ns("2026-04-18T12:00:00Z")

# ─── Public paths ──────────────────────────────────────────────

test_public_health_allowed if {
    authz.allow with input as {"method": "GET", "path": "/proxy/health", "user": {"roles": []}, "client_ip": "1.1.1.1"}
}

test_public_login_allowed if {
    authz.allow with input as {"method": "GET", "path": "/login", "user": {"roles": []}, "client_ip": "1.1.1.1"}
}

test_public_demo_allowed if {
    authz.allow with input as {"method": "GET", "path": "/auth/demo", "user": {"roles": []}, "client_ip": "1.1.1.1"}
}

test_jwks_allowed if {
    authz.allow with input as {"method": "GET", "path": "/.well-known/jwks.json", "user": {"roles": []}, "client_ip": "1.1.1.1"}
}

# ─── Admin role ────────────────────────────────────────────────

test_admin_read_admin_path_in_hours if {
    authz.allow with input as {"method": "GET", "path": "/admin/sessions", "user": {"roles": ["admin"]}, "client_ip": "1.1.1.1"}
        with time.now_ns as in_hours_ns
}

test_admin_write_admin_path_in_hours if {
    authz.allow with input as {"method": "POST", "path": "/admin/sessions/revoke", "user": {"roles": ["admin"]}, "client_ip": "1.1.1.1"}
        with time.now_ns as in_hours_ns
}

test_admin_write_admin_path_off_hours_denied if {
    not authz.allow with input as {"method": "POST", "path": "/admin/sessions/revoke", "user": {"roles": ["admin"]}, "client_ip": "1.1.1.1"}
        with time.now_ns as off_hours_ns
}

test_admin_off_hours_reason_is_time_gated if {
    authz.reason == "outside_business_hours" with input as {
        "method": "POST", "path": "/admin/sessions/revoke",
        "user": {"roles": ["admin"]}, "client_ip": "1.1.1.1",
    } with time.now_ns as off_hours_ns
}

test_admin_api_admin_allowed if {
    authz.allow with input as {"method": "GET", "path": "/api/admin/users", "user": {"roles": ["admin"]}, "client_ip": "1.1.1.1"}
        with time.now_ns as in_hours_ns
}

# ─── Demo / user role (read-only) ──────────────────────────────

test_demo_can_read_admin_dashboard if {
    authz.allow with input as {"method": "GET", "path": "/admin/sessions", "user": {"roles": ["user"]}, "client_ip": "1.1.1.1"}
        with time.now_ns as in_hours_ns
}

test_demo_cannot_write_admin if {
    not authz.allow with input as {"method": "POST", "path": "/admin/sessions/revoke", "user": {"roles": ["user"]}, "client_ip": "1.1.1.1"}
        with time.now_ns as in_hours_ns
}

test_demo_cannot_read_admin_only_path if {
    not authz.allow with input as {"method": "GET", "path": "/admin/sessions/revoke", "user": {"roles": ["user"]}, "client_ip": "1.1.1.1"}
        with time.now_ns as in_hours_ns
}

test_demo_cannot_access_api_admin if {
    not authz.allow with input as {"method": "GET", "path": "/api/admin/users", "user": {"roles": ["user"]}, "client_ip": "1.1.1.1"}
        with time.now_ns as in_hours_ns
}

# ─── HR role ───────────────────────────────────────────────────

test_hr_can_read_hr_path if {
    authz.allow with input as {"method": "GET", "path": "/api/hr/employees", "user": {"roles": ["hr"]}, "client_ip": "1.1.1.1"}
        with time.now_ns as in_hours_ns
}

test_hr_cannot_write_hr_path if {
    not authz.allow with input as {"method": "POST", "path": "/api/hr/employees", "user": {"roles": ["hr"]}, "client_ip": "1.1.1.1"}
        with time.now_ns as in_hours_ns
}

test_hr_write_reason if {
    authz.reason == "hr_write_denied" with input as {
        "method": "POST", "path": "/api/hr/employees",
        "user": {"roles": ["hr"]}, "client_ip": "1.1.1.1",
    } with time.now_ns as in_hours_ns
}

# ─── Viewer role ───────────────────────────────────────────────

test_viewer_can_read_general_api if {
    authz.allow with input as {"method": "GET", "path": "/api/foo", "user": {"roles": ["viewer"]}, "client_ip": "1.1.1.1"}
        with time.now_ns as in_hours_ns
}

test_viewer_cannot_write if {
    not authz.allow with input as {"method": "POST", "path": "/api/foo", "user": {"roles": ["viewer"]}, "client_ip": "1.1.1.1"}
        with time.now_ns as in_hours_ns
}

# ─── Unauthenticated ───────────────────────────────────────────

test_unauthenticated_denied_on_private if {
    not authz.allow with input as {"method": "GET", "path": "/admin/sessions", "user": {"roles": []}, "client_ip": "1.1.1.1"}
        with time.now_ns as in_hours_ns
}

test_unauthenticated_reason if {
    authz.reason == "unauthenticated" with input as {
        "method": "GET", "path": "/admin/sessions",
        "user": {"roles": []}, "client_ip": "1.1.1.1",
    } with time.now_ns as in_hours_ns
}
