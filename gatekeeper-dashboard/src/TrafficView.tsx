import { useCallback, useEffect, useState } from 'react';
import { fetchAuditLogs, type AuditLog, type FetchAuditLogsParams } from './api';
import { PageHeader, PageLayout } from './components/ui/PageLayout';
import { Button } from './components/ui/Button';
import { Badge } from './components/ui/Badge';
import { Card } from './components/ui/Card';
import { Play, Pause, RefreshCw, AlertCircle, Filter, ArrowDown, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export default function TrafficView() {
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [isLive, setIsLive] = useState(true);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [email, setEmail] = useState('');
    const [path, setPath] = useState('');
    const [method, setMethod] = useState('');
    const [statusFilter, setStatusFilter] = useState('');

    const loadLogs = useCallback(async (append = false, isAuto = false) => {
        try {
            if (!isAuto && !append) setLoading(true);
            const params: FetchAuditLogsParams = { count: 100 };
            if (append && nextCursor) { params.cursor = nextCursor; setIsLive(false); }
            if (email.trim()) params.email = email.trim();
            if (path.trim()) params.path = path.trim();
            if (method.trim()) params.method = method.trim();
            if (statusFilter.trim()) params.status_code = statusFilter.trim();
            const res = await fetchAuditLogs(params);
            setLogs(prev => append ? [...prev, ...res.data] : res.data);
            setNextCursor(res.next_cursor);
            setError(null);
        } catch (e) {
            if (!isAuto) setError('Failed to fetch logs: ' + (e instanceof Error ? e.message : 'Unknown error'));
        } finally {
            if (!isAuto) setLoading(false);
        }
    }, [email, path, method, statusFilter, nextCursor]);

    useEffect(() => { loadLogs(); }, []); // eslint-disable-line

    useEffect(() => {
        if (!isLive) return;
        const iv = setInterval(() => loadLogs(false, true), 3000);
        return () => clearInterval(iv);
    }, [isLive, loadLogs]);

    const methodBadge = (m: string) => {
        const map: Record<string, string> = {
            GET:    'bg-emerald-50 text-emerald-700 border-emerald-200',
            POST:   'bg-blue-50 text-blue-700 border-blue-200',
            DELETE: 'bg-red-50 text-red-600 border-red-200',
            PUT:    'bg-amber-50 text-amber-700 border-amber-200',
            PATCH:  'bg-amber-50 text-amber-700 border-amber-200',
        };
        return map[m] ?? 'bg-slate-100 text-slate-600 border-slate-200';
    };

    const statusBadge = (s: number) => {
        if (s >= 200 && s < 300) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
        if (s >= 300 && s < 400) return 'bg-blue-50 text-blue-700 border-blue-200';
        if (s >= 400 && s < 500) return 'bg-amber-50 text-amber-700 border-amber-200';
        if (s >= 500) return 'bg-red-50 text-red-600 border-red-200';
        return 'bg-slate-100 text-slate-600 border-slate-200';
    };

    const hasFilters = email || path || method || statusFilter;

    const inputCls = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400';
    const selectCls = inputCls + ' appearance-none';

    return (
        <PageLayout>
            <PageHeader
                title="Live Traffic"
                description={`${logs.length} events · ${isLive ? 'Auto-refreshing every 3s' : 'Paused'}`}
                action={
                    <div className="flex items-center gap-2">
                        <Button
                            variant={isLive ? 'secondary' : 'default'}
                            size="sm"
                            onClick={() => setIsLive(!isLive)}
                            className={isLive ? 'text-emerald-600 bg-emerald-50 border-emerald-200 hover:bg-emerald-100' : ''}
                        >
                            {isLive
                                ? <><Pause className="mr-1.5 h-3.5 w-3.5" /> Live</>
                                : <><Play className="mr-1.5 h-3.5 w-3.5" /> Paused</>
                            }
                        </Button>
                        <Button variant="outline" size="icon" onClick={() => loadLogs(false)} disabled={loading}>
                            <RefreshCw className={`h-4 w-4 ${loading && !isLive ? 'animate-spin' : ''}`} />
                        </Button>
                    </div>
                }
            />

            {/* Filter bar */}
            <Card className="p-4">
                <form className="flex flex-wrap gap-3 items-end" onSubmit={e => { e.preventDefault(); loadLogs(); }}>
                    <div className="flex flex-col gap-1.5 flex-1 min-w-[140px]">
                        <label className="text-xs font-medium text-slate-500">User Email</label>
                        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="user@example.com" className={inputCls} />
                    </div>
                    <div className="flex flex-col gap-1.5 flex-1 min-w-[140px]">
                        <label className="text-xs font-medium text-slate-500">Path</label>
                        <input value={path} onChange={e => setPath(e.target.value)} placeholder="/api/..." className={inputCls} />
                    </div>
                    <div className="flex flex-col gap-1.5 min-w-[110px]">
                        <label className="text-xs font-medium text-slate-500">Method</label>
                        <select value={method} onChange={e => setMethod(e.target.value)} className={selectCls}>
                            <option value="">All</option>
                            {['GET','POST','PUT','DELETE','PATCH'].map(m => <option key={m}>{m}</option>)}
                        </select>
                    </div>
                    <div className="flex flex-col gap-1.5 min-w-[90px]">
                        <label className="text-xs font-medium text-slate-500">Status</label>
                        <input value={statusFilter} onChange={e => setStatusFilter(e.target.value)} placeholder="403" className={inputCls} />
                    </div>
                    <div className="flex items-center gap-2">
                        <Button type="submit" variant="default" size="sm">
                            <Filter className="mr-1.5 h-3.5 w-3.5" /> Filter
                        </Button>
                        {hasFilters && (
                            <Button type="button" variant="ghost" size="sm" onClick={() => { setEmail(''); setPath(''); setMethod(''); setStatusFilter(''); setTimeout(() => loadLogs(), 0); }}>
                                <X className="mr-1.5 h-3.5 w-3.5" /> Clear
                            </Button>
                        )}
                    </div>
                </form>
            </Card>

            {error ? (
                <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                    <AlertCircle className="h-5 w-5 flex-shrink-0" />
                    {error}
                </div>
            ) : (
                <Card className="overflow-hidden flex flex-col" style={{ height: 'calc(100vh - 22rem)' }}>
                    <div className="overflow-auto flex-1">
                        <table className="w-full text-sm text-left whitespace-nowrap">
                            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
                                <tr>
                                    {['Time','Method','Path','Status','User','Duration','IP'].map(h => (
                                        <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {logs.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="px-4 py-12 text-center text-slate-400 text-sm">
                                            No traffic events match the current filters.
                                        </td>
                                    </tr>
                                ) : logs.map(log => (
                                    <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                                        <td className="px-4 py-3 text-slate-400 text-xs">
                                            {formatDistanceToNow(new Date(log.timestamp), { addSuffix: true })}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${methodBadge(log.method)}`}>
                                                {log.method}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-slate-700 font-mono text-xs truncate max-w-[220px]" title={log.path}>{log.path}</td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold font-mono ${statusBadge(log.status_code)}`}>
                                                {log.status_code}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            {log.email ? (
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-slate-700 text-xs">{log.email}</span>
                                                    {log.roles?.length > 0 && (
                                                        <Badge variant={log.roles.includes('admin') ? 'error' : 'outline'} className="text-[10px] py-0 px-1.5 h-4">
                                                            {log.roles[0]}
                                                        </Badge>
                                                    )}
                                                </div>
                                            ) : (
                                                <span className="text-slate-400 italic text-xs">anonymous</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 font-mono text-xs text-slate-400">{log.duration_ms.toFixed(1)}ms</td>
                                        <td className="px-4 py-3 font-mono text-xs text-slate-400">{log.client_ip}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {nextCursor && (
                        <div className="border-t border-slate-200 bg-slate-50 flex justify-center p-3">
                            <Button variant="secondary" size="sm" onClick={() => loadLogs(true)} disabled={loading}>
                                <ArrowDown className="mr-1.5 h-4 w-4" /> Load older logs
                            </Button>
                        </div>
                    )}
                </Card>
            )}
        </PageLayout>
    );
}
