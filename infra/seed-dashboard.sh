#!/usr/bin/env bash
# seed-dashboard.sh — Generate mock sessions, users, and traffic for the admin dashboard
set -eo pipefail
BASE="http://localhost:8000"

echo "=== Seeding Gatekeeper Dashboard ==="

# ── 1. Create sessions via dev-login (POST form) ───────────────────
EMAILS=("admin@gatekeeper.io" "hr-manager@company.com" "alice@company.com" "bob@company.com" "charlie@company.com" "diana@company.com")
ROLES=("admin" "hr" "user" "user" "admin" "hr")

TOKENS=()

for i in "${!EMAILS[@]}"; do
  email="${EMAILS[$i]}"
  role="${ROLES[$i]}"
  echo "  → Logging in: $email (role: $role)"
  token=$(curl -s -D - -o /dev/null -X POST \
    -d "email=$email&role=$role" \
    "$BASE/auth/dev-login" 2>&1 | grep -i 'set-cookie.*gatekeeper_token' | sed 's/.*gatekeeper_token=//;s/;.*//')
  if [ -n "$token" ]; then
    TOKENS+=("$token")
    echo "    ✓ Session created"
  else
    echo "    ✗ Failed to extract token"
  fi
done

echo ""
echo "=== Created ${#TOKENS[@]} sessions ==="

# ── 2. Generate traffic by making API requests with each token ──────
echo ""
echo "=== Generating traffic ==="

PATHS=(
  "/proxy/health"
  "/metrics"
  "/.well-known/jwks.json"
  "/admin/sessions"
  "/admin/audit-logs"
  "/admin/audit-logs?count=10"
  "/api/protected/resource"
  "/api/admin/settings"
  "/api/hr/employees"
  "/api/data/export"
)

for token in "${TOKENS[@]}"; do
  for path in "${PATHS[@]}"; do
    status=$(curl -s -o /dev/null -w "%{http_code}" -b "gatekeeper_token=$token" "$BASE$path")
    echo "  → $path → $status"
  done
done

# ── 3. Generate some unauthenticated traffic (will get 401s) ────────
echo ""
echo "=== Generating unauthenticated traffic ==="
for path in "/api/protected/resource" "/api/admin/settings" "/api/hr/employees"; do
  status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$path")
  echo "  → $path → $status (unauthenticated)"
done

echo ""
echo "=== Done! Refresh the dashboard at http://localhost:3000 ==="
echo ""
echo "--- Sessions ---"
curl -s "$BASE/admin/sessions" | python3 -m json.tool 2>/dev/null || curl -s "$BASE/admin/sessions"
echo ""
echo "--- Recent audit logs (last 5) ---"
curl -s "$BASE/admin/audit-logs?count=5" | python3 -m json.tool 2>/dev/null || curl -s "$BASE/admin/audit-logs?count=5"
