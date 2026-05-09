import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    fetchAuditLogs,
    fetchSessions,
    killSession,
    revokeSession,
    fetchAdminStatus,
    fetchTrafficMetrics,
    fetchHealth,
    fetchRateLimits,
    fetchApiKeys,
    revokeApiKey,
    simulatePolicy,
} from '../api';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function ok(body: unknown, headers?: Record<string, string>) {
    return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(body),
        headers: new Headers(headers),
    } as Response);
}

function err(status: number) {
    return Promise.resolve({ ok: false, status, json: () => Promise.resolve({}) } as Response);
}

beforeEach(() => {
    mockFetch.mockReset();
});

// ─── fetchHealth ──────────────────────────────────────────────

describe('fetchHealth', () => {
    it('returns status and version', async () => {
        mockFetch.mockReturnValueOnce(ok({ status: 'ok', version: '0.1.0' }));
        const r = await fetchHealth();
        expect(r.status).toBe('ok');
        expect(r.version).toBe('0.1.0');
        expect(mockFetch).toHaveBeenCalledWith('/proxy/health');
    });

    it('throws on non-ok response', async () => {
        mockFetch.mockReturnValueOnce(err(503));
        await expect(fetchHealth()).rejects.toThrow('Failed to fetch health: 503');
    });
});

// ─── fetchAdminStatus ─────────────────────────────────────────

describe('fetchAdminStatus', () => {
    it('returns system status', async () => {
        const payload = { redis_ok: true, opa_enabled: false, mtls_enabled: false, dev_mode: true, version: '0.1.0' };
        mockFetch.mockReturnValueOnce(ok(payload));
        const r = await fetchAdminStatus();
        expect(r.redis_ok).toBe(true);
        expect(r.dev_mode).toBe(true);
    });

    it('throws on error', async () => {
        mockFetch.mockReturnValueOnce(err(401));
        await expect(fetchAdminStatus()).rejects.toThrow('Failed to fetch status: 401');
    });
});

// ─── fetchTrafficMetrics ──────────────────────────────────────

describe('fetchTrafficMetrics', () => {
    it('returns data array from response', async () => {
        const data = [{ time: '2026-05-09T00:00:00Z', success: 10, blocked: 2 }];
        mockFetch.mockReturnValueOnce(ok({ data }));
        const r = await fetchTrafficMetrics();
        expect(r).toHaveLength(1);
        expect(r[0].success).toBe(10);
    });

    it('returns empty array when data key is absent', async () => {
        mockFetch.mockReturnValueOnce(ok({}));
        const r = await fetchTrafficMetrics();
        expect(r).toEqual([]);
    });
});

// ─── fetchAuditLogs ───────────────────────────────────────────

describe('fetchAuditLogs', () => {
    it('builds correct query string with default count', async () => {
        mockFetch.mockReturnValueOnce(ok({ data: [], next_cursor: null }));
        await fetchAuditLogs();
        const url = mockFetch.mock.calls[0][0] as string;
        expect(url).toContain('count=100');
    });

    it('passes optional filters', async () => {
        mockFetch.mockReturnValueOnce(ok({ data: [], next_cursor: null }));
        await fetchAuditLogs({ email: 'a@b.com', method: 'POST', status_code: '403' });
        const url = mockFetch.mock.calls[0][0] as string;
        expect(url).toContain('email=a%40b.com');
        expect(url).toContain('method=POST');
        expect(url).toContain('status_code=403');
    });

    it('returns data and cursor', async () => {
        const entry = { id: '1', action: 'login', timestamp: '', user_id: '', email: 'x@y.com', roles: [], method: 'POST', path: '/auth/dev-login', status_code: 200, client_ip: '127.0.0.1', correlation_id: 'abc', duration_ms: 5 };
        mockFetch.mockReturnValueOnce(ok({ data: [entry], next_cursor: 'tok123' }));
        const r = await fetchAuditLogs({ count: 10 });
        expect(r.data).toHaveLength(1);
        expect(r.next_cursor).toBe('tok123');
    });
});

// ─── fetchSessions ────────────────────────────────────────────

describe('fetchSessions', () => {
    it('returns sessions array', async () => {
        const sessions = [{ jti: 'jti-1', user_id: 'u1', email: 'a@b.com', roles: ['admin'], created_at: '', ttl_seconds: 3600 }];
        mockFetch.mockReturnValueOnce(ok({ data: sessions }));
        const r = await fetchSessions();
        expect(r).toHaveLength(1);
        expect(r[0].jti).toBe('jti-1');
    });

    it('returns empty array when data absent', async () => {
        mockFetch.mockReturnValueOnce(ok({}));
        expect(await fetchSessions()).toEqual([]);
    });
});

// ─── killSession / revokeSession ──────────────────────────────

describe('killSession', () => {
    it('calls DELETE and returns true', async () => {
        mockFetch.mockReturnValueOnce(ok({}));
        const r = await killSession('jti-abc');
        expect(r).toBe(true);
        expect(mockFetch.mock.calls[0][1]).toMatchObject({ method: 'DELETE' });
    });

    it('throws on error', async () => {
        mockFetch.mockReturnValueOnce(err(404));
        await expect(killSession('jti-xyz')).rejects.toThrow('Failed to kill session: 404');
    });
});

describe('revokeSession', () => {
    it('returns revoked boolean from response', async () => {
        mockFetch.mockReturnValueOnce(ok({ revoked: true }));
        const r = await revokeSession('jti-1');
        expect(r).toBe(true);
        const [, opts] = mockFetch.mock.calls[0];
        expect(JSON.parse((opts as RequestInit).body as string)).toMatchObject({ jti: 'jti-1' });
    });
});

// ─── fetchRateLimits ──────────────────────────────────────────

describe('fetchRateLimits', () => {
    it('returns rate limit entries', async () => {
        const data = [{ key: 'rl:anon:127.0.0.1', tier: 'anon', identifier: '127.0.0.1', tokens_remaining: 55.5, ttl_seconds: 60 }];
        mockFetch.mockReturnValueOnce(ok({ data }));
        const r = await fetchRateLimits();
        expect(r[0].tokens_remaining).toBe(55.5);
        expect(r[0].tier).toBe('anon');
    });
});

// ─── fetchApiKeys / revokeApiKey ──────────────────────────────

describe('fetchApiKeys', () => {
    it('returns api key list', async () => {
        const data = [{ key_hash: 'abc', key_prefix: 'gk_abc...', name: 'CI', owner: 'ci@test', roles: ['user'], rate_limit: 1000, created_at: '', last_used: null }];
        mockFetch.mockReturnValueOnce(ok({ data }));
        const r = await fetchApiKeys();
        expect(r[0].name).toBe('CI');
    });
});

describe('revokeApiKey', () => {
    it('calls DELETE on the key hash', async () => {
        mockFetch.mockReturnValueOnce(ok({}));
        await revokeApiKey('deadbeef');
        const [url, opts] = mockFetch.mock.calls[0];
        expect(url).toContain('/deadbeef');
        expect((opts as RequestInit).method).toBe('DELETE');
    });

    it('throws on error', async () => {
        mockFetch.mockReturnValueOnce(err(404));
        await expect(revokeApiKey('nope')).rejects.toThrow('Failed to revoke API key: 404');
    });
});

// ─── simulatePolicy ───────────────────────────────────────────

describe('simulatePolicy', () => {
    it('returns allowed/reason from OPA simulation', async () => {
        mockFetch.mockReturnValueOnce(ok({ allowed: true, reason: 'admin_role_granted', simulated_roles: ['admin'], path: '/admin/status', email: 'a@b.com' }));
        const r = await simulatePolicy({ email: 'a@b.com', roles: ['admin'], path: '/admin/status', method: 'GET' });
        expect(r.allowed).toBe(true);
        expect(r.reason).toBe('admin_role_granted');
    });

    it('throws on non-ok', async () => {
        mockFetch.mockReturnValueOnce(err(500));
        await expect(simulatePolicy({ email: 'x', roles: [], path: '/', method: 'GET' })).rejects.toThrow('Failed to simulate policy');
    });
});
