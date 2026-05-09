import { useCallback, useEffect, useState } from 'react';
import { fetchRateLimits, type RateLimit } from './api';
import { PageHeader, PageLayout } from './components/ui/PageLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './components/ui/Card';
import { Badge } from './components/ui/Badge';
import { Button } from './components/ui/Button';
import { Skeleton } from './components/ui/Skeleton';
import { Gauge, RefreshCw, AlertCircle, Clock, Zap, Hash } from 'lucide-react';

const TIER_BADGE: Record<string, string> = {
    global:  'bg-blue-50 text-blue-700 border-blue-200',
    api_key: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    user:    'bg-amber-50 text-amber-700 border-amber-200',
    ip:      'bg-red-50 text-red-600 border-red-200',
};

function TokenBar({ tokens, max }: { tokens: number; max: number }) {
    const pct = max > 0 ? Math.min((tokens / max) * 100, 100) : 0;
    // Low tokens = exhausted bucket = red; high = healthy = green
    const color = pct < 20 ? 'bg-red-500' : pct < 50 ? 'bg-amber-500' : 'bg-emerald-500';
    return (
        <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs font-semibold text-slate-700 w-10 text-right tabular-nums">{tokens.toFixed(1)}</span>
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
            setLoading(true); setError(null);
            setLimits(await fetchRateLimits());
            setLastRefresh(new Date());
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load rate limits');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
        const iv = setInterval(load, 10000);
        return () => clearInterval(iv);
    }, [load]);

    const maxTokens = limits.length > 0 ? Math.max(...limits.map(l => l.tokens_remaining)) : 1;

    if (loading && limits.length === 0) {
        return (
            <PageLayout>
                <PageHeader title="Rate Limits" description="Per-key request counters" />
                <Skeleton className="h-80 w-full" />
            </PageLayout>
        );
    }

    return (
        <PageLayout>
            <PageHeader
                title="Rate Limits"
                description="Live request counters per identifier — refreshes every 10s"
                action={
                    <Button variant="outline" size="sm" onClick={load} isLoading={loading}>
                        <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
                    </Button>
                }
            />

            {error && (
                <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                    <AlertCircle className="h-4 w-4 shrink-0" /> {error}
                </div>
            )}

            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                    { label: 'Active Keys',     value: String(limits.length),                                      icon: Gauge,     color: 'text-slate-500' },
                    { label: 'Exhausted Keys',  value: String(limits.filter(l => l.tokens_remaining < 5).length),  icon: Zap,       color: 'text-amber-500' },
                    { label: 'Unique Tiers',    value: String(new Set(limits.map(l => l.tier)).size),              icon: Hash,      color: 'text-blue-500' },
                    { label: 'Last Updated',    value: lastRefresh?.toLocaleTimeString() ?? '—',                   icon: RefreshCw, color: 'text-slate-400' },
                ].map(({ label, value, icon: Icon, color }) => (
                    <Card key={label}>
                        <CardContent className="p-4">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium text-slate-500">{label}</span>
                                <Icon className={`h-4 w-4 ${color}`} />
                            </div>
                            <p className="text-xl font-semibold text-slate-900 tabular-nums">{value}</p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {limits.length === 0 ? (
                <Card className="flex flex-col items-center justify-center py-16 border-dashed">
                    <Gauge className="h-10 w-10 text-slate-300 mb-3" />
                    <p className="font-medium text-slate-600">No active rate limit keys</p>
                    <p className="text-sm text-slate-400 mt-1">Keys appear here when requests flow through the proxy.</p>
                </Card>
            ) : (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm flex items-center gap-2">
                            <Gauge className="h-4 w-4 text-slate-500" /> Active Windows
                        </CardTitle>
                        <CardDescription>Sorted by fewest tokens remaining (most active first)</CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left whitespace-nowrap">
                                <thead className="bg-slate-50 border-y border-slate-200">
                                    <tr>
                                        {['Tier','Identifier','Tokens Left','TTL','Redis Key'].map(h => (
                                            <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {limits.map(limit => (
                                        <tr key={limit.key} className="hover:bg-slate-50/80 transition-colors">
                                            <td className="px-4 py-3">
                                                <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${TIER_BADGE[limit.tier] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                                                    {limit.tier}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 font-mono text-xs text-slate-700 max-w-[200px] truncate" title={limit.identifier}>{limit.identifier}</td>
                                            <td className="px-4 py-3 min-w-[160px]">
                                                <TokenBar tokens={limit.tokens_remaining} max={maxTokens} />
                                            </td>
                                            <td className="px-4 py-3">
                                                {limit.ttl_seconds > 0 ? (
                                                    <span className="flex items-center gap-1 text-xs text-slate-500">
                                                        <Clock className="h-3 w-3" /> {limit.ttl_seconds}s
                                                    </span>
                                                ) : (
                                                    <Badge variant="error" className="text-[10px]">expired</Badge>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 font-mono text-[11px] text-slate-400 max-w-[200px] truncate" title={limit.key}>{limit.key}</td>
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
