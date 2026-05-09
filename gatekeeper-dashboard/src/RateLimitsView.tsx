import { useCallback, useEffect, useState } from 'react';
import { fetchRateLimits, type RateLimit } from './api';
import { PageHeader, PageLayout } from './components/ui/PageLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './components/ui/Card';
import { Badge } from './components/ui/Badge';
import { Button } from './components/ui/Button';
import { Skeleton } from './components/ui/Skeleton';
import { Gauge, RefreshCw, AlertCircle, Clock, Zap } from 'lucide-react';

const TIER_COLORS: Record<string, string> = {
    global: 'text-brand-400 border-brand-500/30 bg-brand-500/10',
    api_key: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
    user: 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10',
    ip: 'text-red-400 border-red-500/30 bg-red-500/10',
};

function TierBadge({ tier }: { tier: string }) {
    const cls = TIER_COLORS[tier] ?? 'text-gray-400 border-gray-700 bg-gray-800';
    return (
        <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest border font-mono ${cls}`}>
            {tier}
        </span>
    );
}

function CountBar({ count, max }: { count: number; max: number }) {
    const pct = max > 0 ? Math.min((count / max) * 100, 100) : 0;
    const color = pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-yellow-500' : 'bg-brand-500';
    return (
        <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 bg-surface-700 rounded-none overflow-hidden">
                <div className={`h-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs font-mono text-white w-8 text-right">{count}</span>
        </div>
    );
}

export default function RateLimitsView() {
    const [limits, setLimits] = useState<RateLimit[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

    const load = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await fetchRateLimits();
            setLimits(data);
            setLastRefresh(new Date());
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load rate limits');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
        const interval = setInterval(load, 10000);
        return () => clearInterval(interval);
    }, [load]);

    const maxCount = limits.length > 0 ? Math.max(...limits.map(l => l.count)) : 1;

    const byTier = limits.reduce((acc, l) => {
        if (!acc[l.tier]) acc[l.tier] = [];
        acc[l.tier].push(l);
        return acc;
    }, {} as Record<string, RateLimit[]>);

    if (loading && limits.length === 0) {
        return (
            <PageLayout>
                <PageHeader title="Rate Limits" description="Per-key request counters from Redis" />
                <Skeleton className="h-[400px] w-full" />
            </PageLayout>
        );
    }

    return (
        <PageLayout>
            <PageHeader
                title="Rate Limits"
                description="Live per-identifier request counters — resets on TTL expiry"
                action={
                    <Button variant="outline" onClick={load} isLoading={loading}>
                        <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                }
            />

            {error && (
                <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 text-red-300 text-sm mb-6">
                    <AlertCircle className="h-5 w-5 flex-shrink-0" />
                    {error}
                </div>
            )}

            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-1">
                            <Gauge className="h-4 w-4 text-brand-400" />
                            <span className="text-xs font-bold uppercase tracking-widest text-gray-400">Active Keys</span>
                        </div>
                        <div className="text-2xl font-bold text-white">{limits.length}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-1">
                            <Zap className="h-4 w-4 text-yellow-400" />
                            <span className="text-xs font-bold uppercase tracking-widest text-gray-400">Total Requests</span>
                        </div>
                        <div className="text-2xl font-bold text-white">{limits.reduce((a, l) => a + l.count, 0)}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-1">
                            <Clock className="h-4 w-4 text-emerald-400" />
                            <span className="text-xs font-bold uppercase tracking-widest text-gray-400">Tiers</span>
                        </div>
                        <div className="text-2xl font-bold text-white">{Object.keys(byTier).length}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-1">
                            <RefreshCw className="h-4 w-4 text-gray-400" />
                            <span className="text-xs font-bold uppercase tracking-widest text-gray-400">Last Updated</span>
                        </div>
                        <div className="text-sm font-mono text-white">
                            {lastRefresh ? lastRefresh.toLocaleTimeString() : '--'}
                        </div>
                    </CardContent>
                </Card>
            </div>

            {limits.length === 0 ? (
                <Card className="border-2 border-surface-700 border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-20">
                        <Gauge className="h-12 w-12 text-surface-700 mb-4" />
                        <p className="text-white font-bold text-lg uppercase tracking-widest">No active rate limit keys</p>
                        <p className="text-gray-500 text-sm mt-1 font-mono">Keys appear here when requests are made through the proxy.</p>
                    </CardContent>
                </Card>
            ) : (
                <Card className="border-2 border-surface-700">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Gauge className="h-4 w-4 text-brand-400" />
                            Active Rate Limit Windows
                        </CardTitle>
                        <CardDescription>Sorted by request count — auto-refreshes every 10s</CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left whitespace-nowrap">
                                <thead className="bg-surface-800 border-y-2 border-surface-700">
                                    <tr>
                                        <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-gray-400">Tier</th>
                                        <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-gray-400">Identifier</th>
                                        <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-gray-400 min-w-[160px]">Count</th>
                                        <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-gray-400">TTL</th>
                                        <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-gray-400">Redis Key</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-surface-800">
                                    {limits.map((limit) => (
                                        <tr key={limit.key} className="hover:bg-white/[0.02] transition-colors">
                                            <td className="px-4 py-3">
                                                <TierBadge tier={limit.tier} />
                                            </td>
                                            <td className="px-4 py-3 font-mono text-white text-xs max-w-[200px] truncate" title={limit.identifier}>
                                                {limit.identifier}
                                            </td>
                                            <td className="px-4 py-3 min-w-[160px]">
                                                <CountBar count={limit.count} max={maxCount} />
                                            </td>
                                            <td className="px-4 py-3">
                                                {limit.ttl_seconds > 0 ? (
                                                    <span className="text-xs font-mono text-gray-400 flex items-center gap-1">
                                                        <Clock className="h-3 w-3" />
                                                        {limit.ttl_seconds}s
                                                    </span>
                                                ) : (
                                                    <Badge variant="error" className="text-[10px]">expired</Badge>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 font-mono text-[10px] text-gray-600 max-w-[200px] truncate" title={limit.key}>
                                                {limit.key}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </CardContent>
                </Card>
            )}
        </PageLayout>
    );
}
