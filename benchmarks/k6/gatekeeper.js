// ──────────────────────────────────────────────────────────────
// Gatekeeper Benchmark — Proxy Throughput & Latency
// k6 load test script
//
// Usage:
//   k6 run --out json=results/gatekeeper_baseline.json benchmarks/k6/gatekeeper.js
//   k6 run --env SCENARIO=medium benchmarks/k6/gatekeeper.js
//   k6 run --env SCENARIO=stress benchmarks/k6/gatekeeper.js
// ──────────────────────────────────────────────────────────────

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// ─── Custom metrics ─────────────────────────────────────────

const requestDuration = new Trend('gatekeeper_request_duration', true);
const requestRate = new Rate('gatekeeper_success_rate');
const errorCount = new Counter('gatekeeper_errors');

// ─── Scenarios ──────────────────────────────────────────────

const SCENARIOS = {
  baseline: {
    vus: 100,
    duration: '60s',
    thresholds: {
      http_req_duration: ['p(95)<500', 'p(99)<1000'],
      http_req_failed: ['rate<0.01'],
    },
  },
  medium: {
    vus: 1000,
    duration: '60s',
    thresholds: {
      http_req_duration: ['p(95)<2000', 'p(99)<5000'],
      http_req_failed: ['rate<0.05'],
    },
  },
  stress: {
    vus: 10000,
    duration: '30s',
    thresholds: {
      http_req_duration: ['p(95)<5000'],
      http_req_failed: ['rate<0.10'],
    },
  },
  sustained: {
    vus: 500,
    duration: '300s',
    thresholds: {
      http_req_duration: ['p(95)<1000', 'p(99)<2000'],
      http_req_failed: ['rate<0.01'],
    },
  },
};

const scenario = __ENV.SCENARIO || 'baseline';
const config = SCENARIOS[scenario];

export const options = {
  vus: config.vus,
  duration: config.duration,
  thresholds: config.thresholds,
  tags: {
    test: 'gatekeeper',
    scenario: scenario,
  },
};

// ─── Configuration ──────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || '';

const HEADERS = {
  'Content-Type': 'application/json',
};

if (AUTH_TOKEN) {
  HEADERS['Authorization'] = `Bearer ${AUTH_TOKEN}`;
}

// ─── Payload generators ─────────────────────────────────────

function generatePayload(size) {
  // Generate JSON payload of approximately the given size in bytes
  const data = {
    timestamp: new Date().toISOString(),
    data: 'x'.repeat(Math.max(0, size - 100)),
  };
  return JSON.stringify(data);
}

const PAYLOADS = {
  small: generatePayload(1024),       // 1KB
  medium: generatePayload(102400),    // 100KB
  large: generatePayload(1048576),    // 1MB
};

const payloadSize = __ENV.PAYLOAD || 'small';

// ─── Test scenarios ─────────────────────────────────────────

export default function () {
  const payload = PAYLOADS[payloadSize];

  // Mix of request types to simulate real traffic
  const endpoints = [
    { method: 'GET',  url: `${BASE_URL}/proxy/health` },
    { method: 'GET',  url: `${BASE_URL}/api/hr/employees` },
    { method: 'GET',  url: `${BASE_URL}/.well-known/jwks.json` },
  ];

  // Pick a random endpoint
  const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];

  const startTime = Date.now();
  let res;

  if (endpoint.method === 'GET') {
    res = http.get(endpoint.url, { headers: HEADERS, tags: { endpoint: endpoint.url } });
  } else {
    res = http.post(endpoint.url, payload, { headers: HEADERS, tags: { endpoint: endpoint.url } });
  }

  const duration = Date.now() - startTime;
  requestDuration.add(duration);

  const success = check(res, {
    'status is 2xx or 401': (r) => r.status >= 200 && r.status < 500,
    'response time < 2s': (r) => r.timings.duration < 2000,
  });

  if (success) {
    requestRate.add(1);
  } else {
    requestRate.add(0);
    errorCount.add(1);
  }

  // Small pause between requests to avoid pure hammering
  sleep(0.01);
}

// ─── Summary output ─────────────────────────────────────────

export function handleSummary(data) {
  const summary = {
    test: 'gatekeeper',
    scenario: scenario,
    timestamp: new Date().toISOString(),
    vus: config.vus,
    duration: config.duration,
    metrics: {
      http_req_duration_p50: data.metrics.http_req_duration?.values?.['p(50)'],
      http_req_duration_p95: data.metrics.http_req_duration?.values?.['p(95)'],
      http_req_duration_p99: data.metrics.http_req_duration?.values?.['p(99)'],
      http_req_duration_avg: data.metrics.http_req_duration?.values?.avg,
      http_reqs: data.metrics.http_reqs?.values?.count,
      http_reqs_rate: data.metrics.http_reqs?.values?.rate,
      http_req_failed_rate: data.metrics.http_req_failed?.values?.rate,
    },
  };

  return {
    [`results/gatekeeper_${scenario}.json`]: JSON.stringify(summary, null, 2),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}

import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';
