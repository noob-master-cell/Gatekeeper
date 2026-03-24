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
    ttl_seconds: number;
}

export interface Policy {
    id: number;
    name: string;
    description: string | null;
    pattern: string;
    priority: number;
    is_active: boolean;
    allow_any_authenticated: boolean;
    roles: string[];
}

export interface MetricsData {
    service: string;
    version: string;
    uptime: string;
    python_version: string;
}

// ─── Audit Logs ──────────────────────────────────

export interface AuditLogResponse {
    data: AuditLog[];
    next_cursor: string | null;
}

export interface FetchAuditLogsParams {
    count?: number;
    cursor?: string;
    email?: string;
    path?: string;
    method?: string;
    status_code?: string;
}

export async function fetchAuditLogs(params: FetchAuditLogsParams = {}): Promise<AuditLogResponse> {
    const p = new URLSearchParams();
    if (params.count) p.set('count', params.count.toString());
    else p.set('count', '100');
    if (params.cursor) p.set('cursor', params.cursor);
    if (params.email) p.set('email', params.email);
    if (params.path) p.set('path', params.path);
    if (params.method) p.set('method', params.method);
    if (params.status_code) p.set('status_code', params.status_code);

    const res = await fetch(`${BASE}/admin/audit-logs?${p.toString()}`, { 
        credentials: 'include',
        headers: { 'X-Dashboard-Poll': 'true' }
    });
    if (!res.ok) throw new Error(`Failed to fetch audit logs: ${res.status}`);
    const data = await res.json();
    return { data: data.data ?? [], next_cursor: data.next_cursor ?? null };
}

// ─── Sessions ────────────────────────────────────

export async function fetchSessions(): Promise<Session[]> {
    const res = await fetch(`${BASE}/admin/sessions`, { credentials: 'include' });
    if (!res.ok) throw new Error(`Failed to fetch sessions: ${res.status}`);
    const data = await res.json();
    return data.data ?? [];
}

export async function killSession(jti: string): Promise<boolean> {
    const res = await fetch(`${BASE}/admin/sessions/${jti}`, {
        method: 'DELETE',
        credentials: 'include',
    });
    if (!res.ok) throw new Error(`Failed to kill session: ${res.status}`);
    return true;
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

export interface TrafficMetric {
    time: string;
    success: number;
    blocked: number;
}

export async function fetchTrafficMetrics(): Promise<TrafficMetric[]> {
    const res = await fetch(`${BASE}/admin/metrics/traffic`, { 
        credentials: 'include',
        headers: { 'X-Dashboard-Poll': 'true' }
    });
    if (!res.ok) throw new Error(`Failed to fetch traffic metrics: ${res.status}`);
    const data = await res.json();
    return data.data ?? [];
}

// ─── Health ──────────────────────────────────────

export async function fetchHealth(): Promise<{ status: string; version: string }> {
    const res = await fetch(`${BASE}/proxy/health`);
    if (!res.ok) throw new Error(`Failed to fetch health: ${res.status}`);
    return res.json();
}

// ─── Policies ────────────────────────────────────

export async function fetchPolicies(): Promise<Policy[]> {
    const res = await fetch(`${BASE}/admin/policies`, { credentials: 'include' });
    if (!res.ok) throw new Error(`Failed to fetch policies: ${res.status}`);
    const data = await res.json();
    return data.data ?? [];
}

export async function createPolicy(policy: Partial<Policy>): Promise<void> {
    const res = await fetch(`${BASE}/admin/policies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(policy),
    });
    if (!res.ok) throw new Error(`Failed to create policy: ${res.status}`);
}

export async function deletePolicy(name: string): Promise<void> {
    const res = await fetch(`${BASE}/admin/policies/${encodeURIComponent(name)}`, {
        method: 'DELETE',
        credentials: 'include',
    });
    if (!res.ok) throw new Error(`Failed to delete policy: ${res.status}`);
}

export interface PolicySimulationRequest {
    email: string;
    roles: string[];
    path: string;
    method: string;
}

export interface PolicySimulationResponse {
    allowed: boolean;
    reason: string;
    simulated_roles: string[];
    path: string;
    email: string;
}

export async function simulatePolicy(payload: PolicySimulationRequest): Promise<PolicySimulationResponse> {
    const res = await fetch(`${BASE}/admin/policies/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`Failed to simulate policy: ${res.status}`);
    return res.json();
}

// ─── Device Posture ──────────────────────────────

export interface DevicePostureRule {
    id: number;
    rule_type: string;
    value: string;
    action: string;
    is_active: boolean;
    description: string | null;
}

export async function fetchPostureRules(): Promise<DevicePostureRule[]> {
    const res = await fetch(`${BASE}/admin/posture`, { credentials: 'include' });
    if (!res.ok) throw new Error(`Failed to fetch posture rules: ${res.status}`);
    const data = await res.json();
    return data.data ?? [];
}

export async function createPostureRule(rule: Partial<DevicePostureRule>): Promise<void> {
    const res = await fetch(`${BASE}/admin/posture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(rule),
    });
    if (!res.ok) throw new Error(`Failed to create posture rule: ${res.status}`);
}

export async function deletePostureRule(ruleId: number): Promise<void> {
    const res = await fetch(`${BASE}/admin/posture/${ruleId}`, {
        method: 'DELETE',
        credentials: 'include',
    });
    if (!res.ok) throw new Error(`Failed to delete posture rule: ${res.status}`);
}
