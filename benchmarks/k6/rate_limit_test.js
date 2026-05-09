// ──────────────────────────────────────────────────────────────
// Rate Limit Breach Test
// Verifies the token bucket triggers 429s at the correct rate.
//
// Usage:
//   k6 run benchmarks/k6/rate_limit_test.js
// ──────────────────────────────────────────────────────────────

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

const rateLimitedCount = new Counter('rate_limited_responses');
const allowedCount     = new Counter('allowed_responses');
const blockedRate      = new Rate('blocked_rate');

export const options = {
  scenarios: {
    // Ramp to 500 VUs over 10s, hold 30s, ramp down
    ramp_up: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 500 },
        { duration: '30s', target: 500 },
        { duration: '5s',  target: 0   },
      ],
    },
  },
  thresholds: {
    // We expect rate limiting to kick in — some 429s are correct behaviour
    'rate_limited_responses': ['count>0'],          // must see at least one 429
    'http_req_duration':      ['p(95)<500'],        // latency stays low even under rejection
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';

export default function () {
  const res = http.get(`${BASE_URL}/proxy/health`);

  if (res.status === 429) {
    rateLimitedCount.add(1);
    blockedRate.add(1);
  } else {
    allowedCount.add(1);
    blockedRate.add(0);
  }

  check(res, {
    'status is 200 or 429': (r) => r.status === 200 || r.status === 429,
    'has rate limit headers': (r) =>
      r.headers['X-Ratelimit-Limit'] !== undefined ||
      r.headers['X-Ratelimit-Remaining'] !== undefined,
  });

  // No sleep — hammer as fast as possible to trigger rate limits
}

export function handleSummary(data) {
  return {
    stdout: `
Rate Limit Test Summary
───────────────────────
Total requests : ${data.metrics.http_reqs?.values?.count}
Allowed (2xx)  : ${data.metrics.allowed_responses?.values?.count ?? 0}
Rate limited   : ${data.metrics.rate_limited_responses?.values?.count ?? 0}
Blocked rate   : ${((data.metrics.blocked_rate?.values?.rate ?? 0) * 100).toFixed(1)}%
p95 latency    : ${data.metrics.http_req_duration?.values?.['p(95)']?.toFixed(1)}ms
`,
  };
}
