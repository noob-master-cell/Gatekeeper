// ──────────────────────────────────────────────────────────────
// Baseline Benchmark — Direct to backend (no proxy)
// Measures raw backend performance to calculate proxy overhead
// ──────────────────────────────────────────────────────────────

import http from 'k6/http';
import { check, sleep } from 'k6';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';

const scenario = __ENV.SCENARIO || 'baseline';

const SCENARIOS = {
  baseline: { vus: 100, duration: '60s' },
  medium:   { vus: 1000, duration: '60s' },
  stress:   { vus: 10000, duration: '30s' },
  sustained:{ vus: 500, duration: '300s' },
};

const config = SCENARIOS[scenario];

export const options = {
  vus: config.vus,
  duration: config.duration,
  tags: { test: 'direct-backend', scenario: scenario },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8001';

export default function () {
  const endpoints = [
    `${BASE_URL}/health`,
    `${BASE_URL}/api/hr/employees`,
  ];

  const url = endpoints[Math.floor(Math.random() * endpoints.length)];
  const res = http.get(url);

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  sleep(0.01);
}

export function handleSummary(data) {
  const summary = {
    test: 'direct-backend',
    scenario: scenario,
    timestamp: new Date().toISOString(),
    vus: config.vus,
    duration: config.duration,
    metrics: {
      http_req_duration_p50: data.metrics.http_req_duration?.values?.['p(50)'],
      http_req_duration_p95: data.metrics.http_req_duration?.values?.['p(95)'],
      http_req_duration_p99: data.metrics.http_req_duration?.values?.['p(99)'],
      http_reqs: data.metrics.http_reqs?.values?.count,
      http_reqs_rate: data.metrics.http_reqs?.values?.rate,
    },
  };

  return {
    [`results/direct_${scenario}.json`]: JSON.stringify(summary, null, 2),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}
