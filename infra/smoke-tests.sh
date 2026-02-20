#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# Gatekeeper Smoke Tests — validates the full stack is healthy
# Usage: ./smoke-tests.sh [proxy_url]
# ──────────────────────────────────────────────────────────────
set -euo pipefail

BASE_URL="${1:-http://localhost:8000}"
BACKEND_URL="${2:-http://localhost:8001}"
CP_URL="${3:-http://localhost:8002}"
PASS=0
FAIL=0

green() { printf "\033[32m✅ %s\033[0m\n" "$1"; }
red()   { printf "\033[31m❌ %s\033[0m\n" "$1"; }

check() {
    local desc="$1" url="$2" expect="$3"
    status=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
    if [ "$status" = "$expect" ]; then
        green "$desc (HTTP $status)"
        PASS=$((PASS + 1))
    else
        red "$desc — expected $expect, got $status"
        FAIL=$((FAIL + 1))
    fi
}

check_body() {
    local desc="$1" url="$2" needle="$3"
    body=$(curl -s "$url" 2>/dev/null || echo "")
    if echo "$body" | grep -q "$needle"; then
        green "$desc"
        PASS=$((PASS + 1))
    else
        red "$desc — '$needle' not found in response"
        FAIL=$((FAIL + 1))
    fi
}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Gatekeeper Smoke Tests"
echo "  Proxy:   $BASE_URL"
echo "  Backend: $BACKEND_URL"
echo "  Control: $CP_URL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ─── 1. Service Health ──────────────────────────────────────
echo "▸ Service Health"
check "Proxy health"          "$BASE_URL/proxy/health"  "200"
check "Backend health"        "$BACKEND_URL/health"     "200"
check "Control-plane health"  "$CP_URL/health"          "200"
echo ""

# ─── 2. Auth Endpoints ─────────────────────────────────────
echo "▸ Auth Endpoints"
check "JWKS endpoint"         "$BASE_URL/.well-known/jwks.json"  "200"
check "Login redirect"        "$BASE_URL/login"                   "200"
check "Dev login page"        "$BASE_URL/auth/dev-login"          "200"
check "Protected route (no auth) → 401" "$BASE_URL/api/test" "401"
echo ""

# ─── 3. Auth Flow ──────────────────────────────────────────
echo "▸ Auth Flow (dev login)"
# Perform dev login and capture token
TOKEN_RESPONSE=$(curl -s -c /tmp/gk_smoke_cookies \
    -X POST "$BASE_URL/auth/dev-login" \
    -d "email=smoke@test.com&role=admin" \
    -w "\n%{http_code}" 2>/dev/null || echo "000")
LOGIN_STATUS=$(echo "$TOKEN_RESPONSE" | tail -1)
if [ "$LOGIN_STATUS" = "302" ]; then
    green "Dev login → redirect (HTTP 302)"
    PASS=$((PASS + 1))
else
    red "Dev login — expected 302, got $LOGIN_STATUS"
    FAIL=$((FAIL + 1))
fi

# ─── 4. Authenticated Requests ─────────────────────────────
echo ""
echo "▸ Authenticated Requests"
check "Cookie-based auth to /admin/sessions" \
    "-b /tmp/gk_smoke_cookies $BASE_URL/admin/sessions" "200"

check "Cookie-based auth to /metrics" \
    "-b /tmp/gk_smoke_cookies $BASE_URL/metrics" "200"

echo ""

# ─── 5. RBAC ───────────────────────────────────────────────
echo "▸ RBAC Enforcement"
# Dev login as user role
curl -s -c /tmp/gk_smoke_user -X POST "$BASE_URL/auth/dev-login" \
    -d "email=user@test.com&role=user" -o /dev/null 2>/dev/null || true

check "User role → admin route (expect 403)" \
    "-b /tmp/gk_smoke_user $BASE_URL/api/admin/users" "403"

check "User role → hr route (expect 403)" \
    "-b /tmp/gk_smoke_user $BASE_URL/api/hr/employees" "403"
echo ""

# ─── 6. Metrics / Observability ────────────────────────────
echo "▸ Observability"
check_body "Metrics endpoint returns version" "$BASE_URL/metrics" "0.4.0"
check_body "JWKS has RS256 key" "$BASE_URL/.well-known/jwks.json" "RS256"
echo ""

# ─── Results ────────────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Results: $PASS passed, $FAIL failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Cleanup
rm -f /tmp/gk_smoke_cookies /tmp/gk_smoke_user

exit $FAIL
