/** Gatekeeper API client — calls the proxy admin endpoints. */

const BASE = '';  // Proxied via vite dev server

export interface AuditLog {
    id: string;
    timestamp: string;
    action: string;
    user_id: string;
    email: string;
    roles: string[];
    method: string;
    path: string;
    status_code: number;
    client_ip: string;
    correlation_id: string;
    duration_ms: number;
}

export interface Session {
    jti: string;
    user_id: string;
    email: string;
    roles: string[];
    created_at: string;
    ttl: number;
}

export interface MetricsData {
    service: string;
    version: string;
    uptime: string;
    python_version: string;
}

// ─── Audit Logs ──────────────────────────────────

export async function fetchAuditLogs(count = 100): Promise<AuditLog[]> {
    const res = await fetch(`${BASE}/admin/audit-logs?count=${count}`, { credentials: 'include' });
    if (!res.ok) throw new Error(`Failed to fetch audit logs: ${res.status}`);
    const data = await res.json();
    return data.data ?? [];
}

// ─── Sessions ────────────────────────────────────

export async function fetchSessions(): Promise<Session[]> {
    const res = await fetch(`${BASE}/admin/sessions`, { credentials: 'include' });
    if (!res.ok) throw new Error(`Failed to fetch sessions: ${res.status}`);
    const data = await res.json();
    return data.data ?? [];
}

export async function revokeSession(jti: string): Promise<boolean> {
    const res = await fetch(`${BASE}/admin/sessions/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ jti }),
    });
    if (!res.ok) throw new Error(`Failed to revoke session: ${res.status}`);
    const data = await res.json();
    return data.revoked;
}

export async function revokeAllUserSessions(userId: string): Promise<number> {
    const res = await fetch(`${BASE}/admin/sessions/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ user_id: userId }),
    });
    if (!res.ok) throw new Error(`Failed to revoke sessions: ${res.status}`);
    const data = await res.json();
    return data.revoked_count;
}

// ─── Metrics ─────────────────────────────────────

export async function fetchMetrics(): Promise<MetricsData> {
    const res = await fetch(`${BASE}/metrics`);
    if (!res.ok) throw new Error(`Failed to fetch metrics: ${res.status}`);
    return res.json();
}

// ─── Health ──────────────────────────────────────

export async function fetchHealth(): Promise<{ status: string; version: string }> {
    const res = await fetch(`${BASE}/proxy/health`);
    if (!res.ok) throw new Error(`Failed to fetch health: ${res.status}`);
    return res.json();
}
