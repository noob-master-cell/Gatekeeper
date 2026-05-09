// ──────────────────────────────────────────────────────────────
// Auth Flow Test — full login → protected request → logout cycle
//
// Usage:
//   k6 run benchmarks/k6/auth_flow_test.js
// ──────────────────────────────────────────────────────────────

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const loginLatency     = new Trend('auth_login_duration',    true);
const protectedLatency = new Trend('auth_protected_duration', true);
const authFailures     = new Counter('auth_failures');

export const options = {
  vus: 50,
  duration: '60s',
  thresholds: {
    'auth_login_duration':     ['p(95)<300'],
    'auth_protected_duration': ['p(95)<200'],
    'auth_failures':           ['count<10'],
  },
};

const BASE_URL = __ENV.BASE_URL  || 'http://localhost:8000';
const DEV_MODE = __ENV.DEV_MODE  || 'true';

export default function () {
  group('dev login flow', () => {
    // 1. Dev login (only works when GK_DEV_MODE=true)
    const loginStart = Date.now();
    const loginRes = http.post(
      `${BASE_URL}/auth/dev-login`,
      JSON.stringify({ email: `loadtest+${__VU}@example.com`, roles: ['user'] }),
      { headers: { 'Content-Type': 'application/json' } },
    );
    loginLatency.add(Date.now() - loginStart);

    const loginOk = check(loginRes, {
      'login returns 200': (r) => r.status === 200,
      'sets cookie':       (r) => (r.headers['Set-Cookie'] || '').includes('gatekeeper_token'),
    });

    if (!loginOk) { authFailures.add(1); return; }

    // 2. Hit a protected endpoint with the session cookie
    const jar = http.cookieJar();
    const cookies = loginRes.headers['Set-Cookie'];

    const protStart = Date.now();
    const protRes = http.get(`${BASE_URL}/admin/sessions`, {
      headers: { Cookie: cookies },
    });
    protectedLatency.add(Date.now() - protStart);

    check(protRes, {
      'protected returns 200': (r) => r.status === 200,
    });

    sleep(0.5);
  });
}

export function handleSummary(data) {
  return {
    stdout: `
Auth Flow Test Summary
──────────────────────
Login p95     : ${data.metrics.auth_login_duration?.values?.['p(95)']?.toFixed(1)}ms
Protected p95 : ${data.metrics.auth_protected_duration?.values?.['p(95)']?.toFixed(1)}ms
Auth failures : ${data.metrics.auth_failures?.values?.count ?? 0}
Total reqs    : ${data.metrics.http_reqs?.values?.count}
`,
  };
}
