#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# Run all Gatekeeper benchmarks
# ──────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="${SCRIPT_DIR}/results"

mkdir -p "${RESULTS_DIR}"

echo "═══════════════════════════════════════════════════════"
echo "  Gatekeeper Benchmark Suite"
echo "═══════════════════════════════════════════════════════"
echo ""

# Check k6 is installed
if ! command -v k6 &> /dev/null; then
    echo "❌ k6 not found. Install: brew install grafana/k6/k6"
    exit 1
fi

# Check services are running
echo "🔍 Checking services..."
if ! curl -sf http://localhost:8000/proxy/health > /dev/null 2>&1; then
    echo "❌ Gatekeeper proxy not running on :8000"
    echo "   Run: cd infra && docker compose up -d"
    exit 1
fi

if ! curl -sf http://localhost:8001/health > /dev/null 2>&1; then
    echo "❌ Backend not running on :8001"
    exit 1
fi

echo "✅ Services are up"
echo ""

# ── Run benchmarks ───────────────────────────────────────────

run_benchmark() {
    local name=$1
    local script=$2
    local scenario=$3
    local base_url=${4:-}

    echo "──────────────────────────────────────────────────"
    echo "  📊 ${name} — ${scenario}"
    echo "──────────────────────────────────────────────────"

    local env_args="--env SCENARIO=${scenario}"
    if [ -n "${base_url}" ]; then
        env_args="${env_args} --env BASE_URL=${base_url}"
    fi

    k6 run ${env_args} "${script}" 2>&1 | tee "${RESULTS_DIR}/${name}_${scenario}_output.txt"
    echo ""
}

# Direct backend (baseline — no proxy overhead)
run_benchmark "direct" "${SCRIPT_DIR}/k6/direct_backend.js" "baseline" "http://localhost:8001"

# Gatekeeper proxy (with all security checks)
run_benchmark "gatekeeper" "${SCRIPT_DIR}/k6/gatekeeper.js" "baseline" "http://localhost:8000"

# Higher concurrency
run_benchmark "gatekeeper" "${SCRIPT_DIR}/k6/gatekeeper.js" "medium" "http://localhost:8000"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ✅ Benchmarks complete! Results in: ${RESULTS_DIR}/"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "Generating comparison..."
echo ""

# ── Generate comparison table ────────────────────────────────
if [ -f "${RESULTS_DIR}/direct_baseline.json" ] && [ -f "${RESULTS_DIR}/gatekeeper_baseline.json" ]; then
    echo "┌───────────────────────────────────────────────────────────┐"
    echo "│  Proxy Overhead (Baseline: 100 concurrent, 60s)          │"
    echo "├───────────────────────────────────────────────────────────┤"

    direct_p50=$(python3 -c "import json; d=json.load(open('${RESULTS_DIR}/direct_baseline.json')); print(f\"{d['metrics']['http_req_duration_p50']:.1f}\")")
    gk_p50=$(python3 -c "import json; d=json.load(open('${RESULTS_DIR}/gatekeeper_baseline.json')); print(f\"{d['metrics']['http_req_duration_p50']:.1f}\")")

    echo "│  Direct backend p50:    ${direct_p50}ms"
    echo "│  Gatekeeper proxy p50:  ${gk_p50}ms"
    echo "│  Overhead:              ~$(python3 -c "print(f'{float(${gk_p50}) - float(${direct_p50}):.1f}')")ms per request"
    echo "└───────────────────────────────────────────────────────────┘"
fi
