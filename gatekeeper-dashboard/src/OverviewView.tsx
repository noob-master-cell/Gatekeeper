import { useEffect, useRef, useState } from 'react';
import { fetchHealth, fetchAdminStatus, fetchTrafficMetrics, fetchAuditLogs, type TrafficMetric, type AuditLog, type SystemStatus, type CircuitBreakerStatus } from './api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './components/ui/Card';
import { Badge } from './components/ui/Badge';
import { PageHeader, PageLayout } from './components/ui/PageLayout';
import { Skeleton } from './components/ui/Skeleton';
import { Activity, ShieldCheck, AlertTriangle, Target, UserCog, Radio, Lock, Fingerprint, TrendingUp, ShieldAlert, ShieldOff, Database, Wifi, WifiOff, Zap } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

interface SseData {
    timestamp: string;
    audit_log_entries: number;
    active_sessions: number;
    rate_limited_keys: number;
}

function StatCard({ title, value, sub, icon: Icon, iconColor = 'text-slate-400', accent }: {
    title: string; value: string; sub?: string;
    icon: React.ElementType; iconColor?: string; accent?: boolean;
}) {
    return (
        <Card className={accent ? 'border-brand-200 bg-brand-50' : ''}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className={`text-sm font-medium ${accent ? 'text-brand-700' : 'text-slate-500'}`}>{title}</CardTitle>
                <Icon className={`h-4 w-4 ${iconColor}`} />
            </CardHeader>
            <CardContent>
                <div className={`text-2xl font-semibold ${accent ? 'text-brand-700' : 'text-slate-900'}`}>{value}</div>
                {sub && <p className={`text-xs mt-1 ${accent ? 'text-brand-500' : 'text-slate-400'}`}>{sub}</p>}
            </CardContent>
        </Card>
    );
}

export default function OverviewView() {
    const [health, setHealth] = useState<{ status: string; version: string } | null>(null);
    const [sysStatus, setSysStatus] = useState<SystemStatus | null>(null);
    const [trafficData, setTrafficData] = useState<TrafficMetric[]>([]);
    const [recentBlocks, setRecentBlocks] = useState<AuditLog[]>([]);
    const [topPaths, setTopPaths] = useState<{ path: string; count: number }[]>([]);
    const [topUsers, setTopUsers] = useState<{ email: string; count: number }[]>([]);
    const [sseData, setSseData] = useState<SseData | null>(null);
    const [sseConnected, setSseConnected] = useState(false);
    const esRef = useRef<EventSource | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let mounted = true;
        async function load() {
            try {
                const [ph, status, traffic, auditRes] = await Promise.all([
                    fetchHealth().catch(() => null),
                    fetchAdminStatus().catch(() => null),
                    fetchTrafficMetrics().catch(() => []),
                    fetchAuditLogs({ count: 500 }).catch(() => ({ data: [] })),
                ]);

                if (!mounted) return;

                setHealth(ph);
                setSysStatus(status);

                if (traffic?.length) {
                    setTrafficData(traffic);
                } else {
                    const now = new Date();
                    setTrafficData(Array.from({ length: 24 }, (_, i) => ({
                        time: new Date(now.getTime() - (23 - i) * 3600000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        success: 0, blocked: 0,
                    })));
                }

                const logs: AuditLog[] = auditRes.data || [];
                setRecentBlocks(logs.filter(l => l.status_code >= 400).slice(0, 6));

                const pathMap = logs.reduce((a, l) => {
                    if (!l.path) return a;
                    return { ...a, [l.path]: (a[l.path] || 0) + 1 };
                }, {} as Record<string, number>);
                setTopPaths(Object.entries(pathMap).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([path, count]) => ({ path, count })));

                const userMap = logs.reduce((a, l) => { const e = l.email || 'anonymous'; return { ...a, [e]: (a[e] || 0) + 1 }; }, {} as Record<string, number>);
                setTopUsers(Object.entries(userMap).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([email, count]) => ({ email, count })));
            } finally {
                if (mounted) setLoading(false);
            }
        }
        load();
        const iv = setInterval(load, 30000);
        return () => { mounted = false; clearInterval(iv); };
    }, []);

    // SSE live feed
    useEffect(() => {
        const es = new EventSource('/admin/stream');
        esRef.current = es;
        es.onopen = () => setSseConnected(true);
        es.onmessage = (e) => { try { setSseData(JSON.parse(e.data)); } catch { /* ignore */ } };
        es.onerror = () => { setSseConnected(false); es.close(); };
        return () => { es.close(); setSseConnected(false); };
    }, []);

    const pOk = health?.status === 'ok';
    const total24h = trafficData.reduce((s, h) => s + h.success + h.blocked, 0);
    const blocked24h = trafficData.reduce((s, h) => s + h.blocked, 0);
    const blockRate = total24h > 0 ? Math.round((blocked24h / total24h) * 100) : 0;

    if (loading) {
        return (
            <PageLayout>
                <PageHeader title="Dashboard" description="Zero-trust telemetry overview" />
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
                </div>
                <Skeleton className="h-72 w-full mt-4" />
            </PageLayout>
        );
    }

    return (
        <PageLayout>
            <PageHeader title="Dashboard" description="Zero-trust system telemetry" />

            {/* Stats row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                    title="Proxy"
                    value={pOk ? 'Healthy' : 'Offline'}
                    sub={`v${health?.version || '—'}`}
                    icon={Activity}
                    iconColor={pOk ? 'text-emerald-500' : 'text-red-500'}
                />
                <StatCard
                    title="Requests (24h)"
                    value={total24h > 0 ? total24h.toLocaleString() : '—'}
                    sub={total24h > 0 ? `${blocked24h.toLocaleString()} blocked` : 'No traffic yet'}
                    icon={TrendingUp}
                    iconColor="text-blue-400"
                />
                <StatCard
                    title="Block Rate (24h)"
                    value={total24h > 0 ? `${blockRate}%` : '—'}
                    sub={total24h > 0 ? `${(total24h - blocked24h).toLocaleString()} allowed` : 'No data'}
                    icon={ShieldAlert}
                    iconColor={blockRate > 20 ? 'text-red-500' : blockRate > 5 ? 'text-amber-500' : 'text-emerald-500'}
                    accent={blockRate > 20}
                />
                <StatCard
                    title="Active Sessions"
                    value={sseData ? String(sseData.active_sessions) : '—'}
                    sub={sseConnected ? 'Streaming live' : 'Connecting…'}
                    icon={Radio}
                    iconColor={sseConnected ? 'text-emerald-500' : 'text-slate-300'}
                />
            </div>

            {/* Security posture pills — dynamic */}
            <div className="flex flex-wrap gap-2">
                {/* Proxy health */}
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium ${pOk ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
                    <Activity className="h-3.5 w-3.5" />
                    Proxy {pOk ? 'Online' : 'Offline'}
                </div>

                {/* mTLS */}
                {sysStatus && (
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium ${sysStatus.mtls_enabled ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                        <Lock className="h-3.5 w-3.5" />
                        mTLS {sysStatus.mtls_enabled ? 'On' : 'Off'}
                    </div>
                )}

                {/* RBAC — always enforced */}
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium bg-blue-50 text-blue-700 border-blue-200">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    RBAC Active
                </div>

                {/* OPA */}
                {sysStatus && (
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium ${sysStatus.opa_enabled ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                        <Fingerprint className="h-3.5 w-3.5" />
                        OPA {sysStatus.opa_enabled ? 'Evaluating' : 'Disabled'}
                    </div>
                )}

                {/* Redis */}
                {sysStatus && (
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium ${sysStatus.redis_ok ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
                        <Database className="h-3.5 w-3.5" />
                        Redis {sysStatus.redis_ok ? 'Connected' : 'Down'}
                    </div>
                )}

                {/* Dev mode warning */}
                {sysStatus?.dev_mode && (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium bg-amber-50 text-amber-700 border-amber-200">
                        <ShieldOff className="h-3.5 w-3.5" />
                        Dev Mode
                    </div>
                )}

                {/* Circuit breakers */}
                {sysStatus?.circuit_breakers?.map((cb: CircuitBreakerStatus) => {
                    const isOpen = cb.state === 'open';
                    const isHalf = cb.state === 'half_open';
                    return (
                        <div key={cb.name} className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium ${
                            isOpen ? 'bg-red-50 text-red-700 border-red-200' :
                            isHalf ? 'bg-amber-50 text-amber-700 border-amber-200' :
                            'bg-emerald-50 text-emerald-700 border-emerald-200'
                        }`}>
                            <Zap className="h-3.5 w-3.5" />
                            CB:{cb.name} {isOpen ? 'OPEN' : isHalf ? 'HALF' : 'OK'}
                        </div>
                    );
                })}

                {/* SSE connection */}
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium ${sseConnected ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-400 border-slate-200'}`}>
                    {sseConnected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                    {sseConnected ? 'Live Feed' : 'Feed Offline'}
                </div>
            </div>

            {/* Traffic chart */}
            <Card>
                <CardHeader>
                    <CardTitle>Traffic Volume — 24h</CardTitle>
                    <CardDescription>Allowed vs blocked requests over time</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="w-full">
                        <ResponsiveContainer width="100%" height={256} minWidth={0}>
                            <AreaChart data={trafficData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="gSuccess" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.15} />
                                        <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="gBlocked" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#ef4444" stopOpacity={0.15} />
                                        <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <XAxis dataKey="time" stroke="#cbd5e1" fontSize={11} tickLine={false} axisLine={false} minTickGap={30} />
                                <YAxis stroke="#cbd5e1" fontSize={11} tickLine={false} axisLine={false} />
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <Tooltip
                                    contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: 12 }}
                                    itemStyle={{ color: '#475569' }}
                                />
                                <Area type="monotone" dataKey="success" name="Allowed" stroke="#10b981" strokeWidth={2} fill="url(#gSuccess)" />
                                <Area type="monotone" dataKey="blocked" name="Blocked" stroke="#ef4444" strokeWidth={2} fill="url(#gBlocked)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </CardContent>
            </Card>

            {/* Bottom two-column grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left: top paths + top users */}
                <div className="space-y-6">
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="flex items-center gap-2 text-sm">
                                <Target className="h-4 w-4 text-blue-500" /> Top Endpoints
                            </CardTitle>
                            <CardDescription>Most accessed paths</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {topPaths.length === 0
                                ? <p className="text-slate-400 text-sm">No data yet.</p>
                                : topPaths.map((item, idx) => {
                                    const pct = topPaths[0].count > 0 ? (item.count / topPaths[0].count) * 100 : 0;
                                    return (
                                        <div key={idx}>
                                            <div className="flex items-center justify-between text-sm mb-1">
                                                <span className="text-slate-700 font-mono text-xs truncate max-w-[220px]" title={item.path}>{item.path}</span>
                                                <span className="text-slate-500 text-xs ml-2">{item.count}</span>
                                            </div>
                                            <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                                                <div className="h-full bg-blue-400 rounded-full" style={{ width: `${pct}%` }} />
                                            </div>
                                        </div>
                                    );
                                })}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="flex items-center gap-2 text-sm">
                                <UserCog className="h-4 w-4 text-brand-500" /> Top Identities
                            </CardTitle>
                            <CardDescription>Most active accounts</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-2.5">
                            {topUsers.length === 0
                                ? <p className="text-slate-400 text-sm">No data yet.</p>
                                : topUsers.map((item, idx) => (
                                    <div key={idx} className="flex items-center justify-between">
                                        <div className="flex items-center gap-2.5">
                                            <div className="h-7 w-7 rounded-full bg-slate-100 flex items-center justify-center text-xs font-semibold text-slate-600">
                                                {item.email[0]?.toUpperCase()}
                                            </div>
                                            <span className={`text-sm truncate max-w-[180px] ${item.email === 'anonymous' ? 'text-slate-400 italic' : 'text-slate-700'}`}>{item.email}</span>
                                        </div>
                                        <Badge variant="outline" className="text-xs">{item.count}</Badge>
                                    </div>
                                ))}
                        </CardContent>
                    </Card>
                </div>

                {/* Right: security blocks */}
                <Card className="flex flex-col">
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-sm">
                            <AlertTriangle className="h-4 w-4 text-red-500" /> Recent Blocks
                        </CardTitle>
                        <CardDescription>Latest 401 / 403 denials</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-1 p-0 overflow-hidden">
                        {recentBlocks.length === 0 ? (
                            <div className="p-6 text-center text-slate-400 text-sm">
                                No security blocks detected.
                            </div>
                        ) : (
                            <div className="divide-y divide-slate-100">
                                {recentBlocks.map(log => (
                                    <div key={log.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors">
                                        <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600 border border-red-200 font-mono shrink-0">
                                            {log.status_code}
                                        </span>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm text-slate-700 font-mono truncate">{log.path}</p>
                                            <p className="text-xs text-slate-400 truncate">{log.email || 'anonymous'}</p>
                                        </div>
                                        <span className="text-[11px] text-slate-400 shrink-0">
                                            {formatDistanceToNow(new Date(log.timestamp), { addSuffix: true })}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </PageLayout>
    );
}
