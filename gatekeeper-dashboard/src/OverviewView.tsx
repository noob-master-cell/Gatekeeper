import { useEffect, useState } from 'react';
import { fetchHealth, fetchMetrics, fetchTrafficMetrics, fetchAuditLogs, type TrafficMetric, type AuditLog } from './api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './components/ui/Card';
import { Badge } from './components/ui/Badge';
import { PageHeader, PageLayout } from './components/ui/PageLayout';
import { Skeleton } from './components/ui/Skeleton';
import { Activity, Server, Users, ShieldAlert, AlertTriangle, Target, UserCog } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';

export default function OverviewView() {
    const [proxyData, setProxyData] = useState<any>(null);
    const [backendData, setBackendData] = useState<any>(null);
    const [trafficData, setTrafficData] = useState<TrafficMetric[]>([]);
    
    // Mission Control Telemetry Data
    const [recentBlocks, setRecentBlocks] = useState<AuditLog[]>([]);
    const [topPaths, setTopPaths] = useState<{path: string, count: number}[]>([]);
    const [topUsers, setTopUsers] = useState<{email: string, count: number}[]>([]);
    
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function load() {
            try {
                const [ph, pm, traffic, auditRes] = await Promise.all([
                    fetchHealth().catch(() => null),
                    fetchMetrics().catch(() => null),
                    fetchTrafficMetrics().catch(() => []),
                    fetchAuditLogs({ count: 500 }).catch(() => ({ data: [] }))
                ]);

                setProxyData({ health: ph, metrics: pm });
                setBackendData({ status: ph ? 'ok' : 'error' });

                // Traffic data implies the API worked
                if (traffic && traffic.length > 0) {
                    setTrafficData(traffic);
                } else {
                    // Fallback empty dataset for rendering smooth curve if nothing is blocked/allowed
                    const now = new Date();
                    const emptyData = Array.from({ length: 24 }).map((_, i) => ({
                        time: new Date(now.getTime() - (23 - i) * 3600000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        success: 0,
                        blocked: 0,
                    }));
                    setTrafficData(emptyData);
                }

                // Process Audit Logs for Mission Control Telemetry
                const logs: AuditLog[] = auditRes.data || [];
                
                // 1. Recent Security Blocks
                const blocks = logs.filter(l => l.status_code >= 400).slice(0, 5);
                setRecentBlocks(blocks);

                // 2. Top Paths
                const pathCounts = logs.reduce((acc, log) => {
                    acc[log.path] = (acc[log.path] || 0) + 1;
                    return acc;
                }, {} as Record<string, number>);
                const sortedPaths = Object.entries(pathCounts)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5)
                    .map(([path, count]) => ({ path, count }));
                setTopPaths(sortedPaths);

                // 3. Top Active Users
                const userCounts = logs.reduce((acc, log) => {
                    const email = log.email || 'anonymous';
                    acc[email] = (acc[email] || 0) + 1;
                    return acc;
                }, {} as Record<string, number>);
                const sortedUsers = Object.entries(userCounts)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5)
                    .map(([email, count]) => ({ email, count }));
                setTopUsers(sortedUsers);

            } finally {
                setLoading(false);
            }
        }
        
        load();
        const interval = setInterval(load, 30000); // Poll every 30s
        return () => clearInterval(interval);
    }, []);

    if (loading) {
        return (
            <PageLayout>
                <PageHeader title="Mission Control" description="Zero-Trust System Telemetry" />
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
                    {[...Array(4)].map((_, i) => (
                        <Skeleton key={i} className="h-32 w-full" />
                    ))}
                </div>
                <Skeleton className="h-[400px] w-full mt-6" />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
                    <Skeleton className="h-[300px] w-full" />
                    <Skeleton className="h-[300px] w-full" />
                </div>
            </PageLayout>
        );
    }

    const pOk = proxyData?.health?.status === 'ok';
    const bOk = backendData?.status === 'ok';

    return (
        <PageLayout>
            <PageHeader
                title="Mission Control"
                description="Zero-Trust System Telemetry"
            />

            {/* Row 1: Key Stats */}
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-gray-400">Proxy Health</CardTitle>
                        <Activity className={pOk ? "h-4 w-4 text-emerald-400" : "h-4 w-4 text-red-400"} />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">{pOk ? 'Healthy' : 'Offline'}</div>
                        <p className="text-xs text-gray-500 mt-1">v{proxyData?.health?.version || 'unknown'}</p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-gray-400">Backend API</CardTitle>
                        <Server className={bOk ? "h-4 w-4 text-emerald-400" : "h-4 w-4 text-red-400"} />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">{bOk ? 'Healthy' : 'Offline'}</div>
                        <p className="text-xs text-gray-500 mt-1">Connected to internal services</p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-gray-400">Total Uptime</CardTitle>
                        <ShieldAlert className="h-4 w-4 text-brand-400" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">
                            {proxyData?.metrics?.uptime_seconds
                                ? `${Math.floor(proxyData.metrics.uptime_seconds / 3600)}h ${Math.floor((proxyData.metrics.uptime_seconds % 3600) / 60)}m`
                                : '--'}
                        </div>
                        <p className="text-xs text-brand-400/80 mt-1">Python {proxyData?.metrics?.python_version || '--'}</p>
                    </CardContent>
                </Card>

                <Card className="bg-brand-500 border-2 border-surface-950 shadow-te">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-bold text-black uppercase tracking-widest">Active Setup</CardTitle>
                        <Users className="h-5 w-5 text-black" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-black uppercase">Full Zero-Trust</div>
                        <p className="text-xs text-black/80 mt-1 flex items-center gap-1 font-mono font-bold">
                            MTLS + RBAC ENABLED
                        </p>
                    </CardContent>
                </Card>
            </div>

            {/* Row 2: Traffic Volume Chart */}
            <div className="mt-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Traffic Volume (24h)</CardTitle>
                        <CardDescription>Successful and blocked requests over time</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[280px] w-full mt-4">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart
                                    data={trafficData}
                                    margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                                >
                                    <defs>
                                        <linearGradient id="colorSuccess" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#00E5FF" stopOpacity={0.8} />
                                            <stop offset="100%" stopColor="#00E5FF" stopOpacity={0.1} />
                                        </linearGradient>
                                        <linearGradient id="colorBlocked" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#FF3A20" stopOpacity={0.8} />
                                            <stop offset="100%" stopColor="#FF3A20" stopOpacity={0.1} />
                                        </linearGradient>
                                    </defs>
                                    <XAxis
                                        dataKey="time"
                                        stroke="#475569"
                                        fontSize={12}
                                        tickLine={false}
                                        axisLine={false}
                                        minTickGap={30}
                                    />
                                    <YAxis
                                        stroke="#475569"
                                        fontSize={12}
                                        tickLine={false}
                                        axisLine={false}
                                        tickFormatter={(value) => `${value}`}
                                    />
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: '0px' }}
                                        itemStyle={{ color: '#e2e8f0' }}
                                    />
                                    <Area
                                        type="step"
                                        dataKey="success"
                                        name="Allowed"
                                        stroke="#00E5FF"
                                        strokeWidth={3}
                                        fillOpacity={1}
                                        fill="url(#colorSuccess)"
                                    />
                                    <Area
                                        type="step"
                                        dataKey="blocked"
                                        name="Blocked (401/403)"
                                        stroke="#FF3A20"
                                        strokeWidth={3}
                                        fillOpacity={1}
                                        fill="url(#colorBlocked)"
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Row 3: Densified Telemetry (Top Paths, Top Users) & Security Feed */}
            <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1">
                
                {/* Left Column: Top Paths & Top Users */}
                <div className="flex flex-col gap-6">
                    <Card className="flex-1">
                        <CardHeader className="pb-3 flex flex-row items-center justify-between">
                            <div>
                                <CardTitle className="text-md flex items-center gap-2">
                                    <Target className="h-4 w-4 text-emerald-400"/> Top Targets
                                </CardTitle>
                                <CardDescription>Most accessed application paths</CardDescription>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                {topPaths.length === 0 ? <p className="text-gray-500 text-sm">No traffic data.</p> : 
                                    topPaths.map((item, idx) => (
                                        <div key={idx} className="flex items-center justify-between text-sm">
                                            <div className="flex items-center gap-3 overflow-hidden">
                                                <span className="text-gray-500 font-mono text-xs w-4">{idx + 1}.</span>
                                                <span className="text-gray-200 font-mono truncate max-w-[200px]" title={item.path}>{item.path}</span>
                                            </div>
                                            <Badge variant="outline" className="font-mono bg-surface-900">{item.count} req</Badge>
                                        </div>
                                    ))
                                }
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="flex-1">
                        <CardHeader className="pb-3 flex flex-row items-center justify-between">
                            <div>
                                <CardTitle className="text-md flex items-center gap-2">
                                    <UserCog className="h-4 w-4 text-brand-400"/> Top Identities
                                </CardTitle>
                                <CardDescription>Most hyperactive accounts</CardDescription>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                {topUsers.length === 0 ? <p className="text-gray-500 text-sm">No identity data.</p> : 
                                    topUsers.map((item, idx) => (
                                        <div key={idx} className="flex items-center justify-between text-sm">
                                            <div className="flex items-center gap-3 overflow-hidden">
                                                <span className="text-gray-500 font-mono text-xs w-4">{idx + 1}.</span>
                                                <span className={`${item.email === 'anonymous' ? 'text-gray-500 italic' : 'text-gray-200'} truncate max-w-[200px]`} title={item.email}>{item.email}</span>
                                            </div>
                                            <Badge variant="outline" className="font-mono bg-surface-900 border-brand-500/30 text-brand-400">{item.count}</Badge>
                                        </div>
                                    ))
                                }
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Right Column: Security Blocks Feed */}
                <Card className="flex flex-col">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-md flex items-center gap-2 text-red-400">
                            <AlertTriangle className="h-4 w-4"/> Recent Threat Blocks
                        </CardTitle>
                        <CardDescription>Latest 401/403 authorization denials</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-1 overflow-x-auto p-0">
                        {recentBlocks.length === 0 ? (
                            <div className="p-6 text-center text-gray-500 text-sm">No security blocks detected recently.</div>
                        ) : (
                            <table className="w-full text-left text-sm whitespace-nowrap">
                                <thead className="bg-surface-800 border-y-2 border-surface-700">
                                    <tr>
                                        <th className="px-4 py-2 font-medium text-gray-400 uppercase tracking-wider text-[10px]">Time</th>
                                        <th className="px-4 py-2 font-medium text-gray-400 uppercase tracking-wider text-[10px]">Path</th>
                                        <th className="px-4 py-2 font-medium text-gray-400 uppercase tracking-wider text-[10px]">User</th>
                                        <th className="px-4 py-2 font-medium text-gray-400 uppercase tracking-wider text-[10px]">Stat</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-800/50">
                                    {recentBlocks.map(log => (
                                        <tr key={log.id} className="hover:bg-white/[0.02] transition-colors">
                                            <td className="px-4 py-3 text-gray-500 font-mono text-[11px]">
                                                {formatDistanceToNow(new Date(log.timestamp), { addSuffix: true })}
                                            </td>
                                            <td className="px-4 py-3 text-gray-300 font-mono text-[11px] max-w-[120px] truncate" title={log.path}>
                                                {log.path}
                                            </td>
                                            <td className="px-4 py-3 text-[11px] max-w-[100px] truncate" title={log.email || 'anonymous'}>
                                                {log.email ? <span className="text-gray-300">{log.email}</span> : <span className="text-gray-500 italic">anon</span>}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="text-red-500 font-bold border border-red-500 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-mono">
                                                    {log.status_code}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </CardContent>
                </Card>

            </div>
        </PageLayout>
    );
}
