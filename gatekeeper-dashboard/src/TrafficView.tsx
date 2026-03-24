import { useCallback, useEffect, useState } from 'react';
import { fetchAuditLogs, type AuditLog, type FetchAuditLogsParams } from './api';
import { PageHeader, PageLayout } from './components/ui/PageLayout';
import { Button } from './components/ui/Button';
import { Badge } from './components/ui/Badge';
import { Card } from './components/ui/Card';
import { Play, Pause, RefreshCw, AlertCircle, Filter, ArrowDown } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export default function TrafficView() {
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [isLive, setIsLive] = useState(true);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Filters
    const [email, setEmail] = useState('');
    const [path, setPath] = useState('');
    const [method, setMethod] = useState('');
    const [statusFilter, setStatusFilter] = useState('');

    const loadLogs = useCallback(async (append = false, isAuto = false) => {
        try {
            if (!isAuto && !append) setLoading(true);
            const params: FetchAuditLogsParams = { count: 100 };
            
            if (append && nextCursor) {
                params.cursor = nextCursor;
                // Automatically pause live stream if we start digging into history
                setIsLive(false); 
            }

            if (email.trim()) params.email = email.trim();
            if (path.trim()) params.path = path.trim();
            if (method.trim()) params.method = method.trim();
            if (statusFilter.trim()) params.status_code = statusFilter.trim();

            const res = await fetchAuditLogs(params);
            
            setLogs(prev => append ? [...prev, ...res.data] : res.data);
            setNextCursor(res.next_cursor);
            setError(null);
        } catch (e) {
            if (!isAuto) setError('Failed to fetch audit logs: ' + (e instanceof Error ? e.message : 'Unknown error'));
            else console.error('Auto-refresh failed:', e);
        } finally {
            if (!isAuto) setLoading(false);
        }
    }, [email, path, method, statusFilter, nextCursor]);

    // Initial load
    useEffect(() => {
        loadLogs();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Live stream interval
    useEffect(() => {
        if (!isLive) return;
        const interval = setInterval(() => loadLogs(false, true), 3000);
        return () => clearInterval(interval);
    }, [isLive, loadLogs]);

    const handleFilterSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        // Submitting new filters resets pagination
        loadLogs(false, false);
    };

    const handleClearFilters = () => {
        setEmail('');
        setPath('');
        setMethod('');
        setStatusFilter('');
        // Let state update before fetching
        setTimeout(() => loadLogs(false, false), 0);
    };

    const methodColor = (m: string) => {
        if (m === 'GET') return 'text-emerald-500 bg-surface-900 border-2 border-emerald-500 shadow-te-sm';
        if (m === 'POST') return 'text-brand-500 bg-surface-900 border-2 border-brand-500 shadow-te-sm';
        if (m === 'DELETE') return 'text-red-500 bg-surface-900 border-2 border-red-500 shadow-te-sm';
        if (m === 'PUT' || m === 'PATCH') return 'text-amber-500 bg-surface-900 border-2 border-amber-500 shadow-te-sm';
        return 'text-gray-400 bg-surface-900 border-2 border-gray-400 shadow-te-sm';
    };

    const statusColor = (s: number) => {
        if (s >= 200 && s < 300) return 'text-emerald-500 bg-surface-900 border-2 border-emerald-500 shadow-te-sm';
        if (s >= 300 && s < 400) return 'text-brand-500 bg-surface-900 border-2 border-brand-500 shadow-te-sm';
        if (s >= 400 && s < 500) return 'text-amber-500 bg-surface-900 border-2 border-amber-500 shadow-te-sm';
        if (s >= 500) return 'text-red-500 bg-surface-900 border-2 border-red-500 shadow-te-sm';
        return 'text-gray-400 bg-surface-900 border-2 border-gray-400 shadow-te-sm';
    };

    return (
        <PageLayout>
            <PageHeader
                title="Live Traffic"
                description={`${logs.length} events · ${isLive ? 'Auto-refreshing' : 'Paused'}`}
                action={
                    <div className="flex items-center gap-2">
                        <Button
                            variant={isLive ? 'secondary' : 'default'}
                            size="sm"
                            onClick={() => setIsLive(!isLive)}
                            className={isLive ? 'text-emerald-400 border-emerald-500/20' : ''}
                        >
                            {isLive ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
                            {isLive ? 'Live' : 'Paused'}
                        </Button>
                        <Button variant="outline" size="icon" onClick={() => loadLogs(false)} disabled={loading}>
                            <RefreshCw className={`h-4 w-4 ${loading && !isLive ? 'animate-spin' : ''}`} />
                        </Button>
                    </div>
                }
            />

            {/* Teenage Engineering Filter Panel */}
            <Card className="border-2 border-surface-700 bg-surface-900 shadow-te p-4 mb-6">
                <form 
                    className="flex flex-wrap gap-4 items-end"
                    onSubmit={handleFilterSubmit}
                >
                    <div className="flex flex-col gap-1.5 flex-1 min-w-[150px]">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">User Email</label>
                        <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="*@example.com" className="w-full bg-surface-950 border-2 border-surface-700 rounded-none px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none shadow-te-sm font-mono placeholder:text-surface-700" />
                    </div>
                    <div className="flex flex-col gap-1.5 flex-1 min-w-[150px]">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Path</label>
                        <input value={path} onChange={e=>setPath(e.target.value)} placeholder="/api/..." className="w-full bg-surface-950 border-2 border-surface-700 rounded-none px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none shadow-te-sm font-mono placeholder:text-surface-700" />
                    </div>
                    <div className="flex flex-col gap-1.5 min-w-[120px]">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Method</label>
                        <select value={method} onChange={e=>setMethod(e.target.value)} className="w-full bg-surface-950 border-2 border-surface-700 rounded-none px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none shadow-te-sm font-mono appearance-none uppercase tracking-widest font-bold">
                            <option value="">ALL</option>
                            <option value="GET">GET</option>
                            <option value="POST">POST</option>
                            <option value="PUT">PUT</option>
                            <option value="DELETE">DELETE</option>
                            <option value="PATCH">PATCH</option>
                        </select>
                    </div>
                    <div className="flex flex-col gap-1.5 min-w-[100px]">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Status</label>
                        <input value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} placeholder="e.g. 403" className="w-full bg-surface-950 border-2 border-surface-700 rounded-none px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none shadow-te-sm font-mono placeholder:text-surface-700" />
                    </div>
                    <div className="flex items-center gap-2">
                        <Button type="submit" variant="default" className="whitespace-nowrap min-w-[100px] h-[40px]">
                            {loading && !isLive ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Filter className="mr-2 h-4 w-4" />}
                            Filter
                        </Button>
                        {(email || path || method || statusFilter) && (
                            <Button type="button" variant="outline" className="h-[40px] px-3" onClick={handleClearFilters}>
                                Clear
                            </Button>
                        )}
                    </div>
                </form>
            </Card>

            {error ? (
                <div className="flex items-center p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-300 text-sm">
                    <AlertCircle className="h-5 w-5 mr-3 flex-shrink-0" />
                    {error}
                </div>
            ) : (
                <Card className="overflow-hidden flex flex-col h-[calc(100vh-22rem)]">
                    <div className="overflow-x-auto flex-1 h-full">
                        <table className="w-full text-left text-sm whitespace-nowrap border-collapse">
                            <thead className="sticky top-0 bg-surface-800 border-b-2 border-surface-700 z-10 shadow-sm">
                                <tr>
                                    <th className="px-5 py-3.5 font-medium text-gray-400 uppercase tracking-wider text-[11px]">Time</th>
                                    <th className="px-5 py-3.5 font-medium text-gray-400 uppercase tracking-wider text-[11px]">Method</th>
                                    <th className="px-5 py-3.5 font-medium text-gray-400 uppercase tracking-wider text-[11px]">Path</th>
                                    <th className="px-5 py-3.5 font-medium text-gray-400 uppercase tracking-wider text-[11px]">Status</th>
                                    <th className="px-5 py-3.5 font-medium text-gray-400 uppercase tracking-wider text-[11px]">User</th>
                                    <th className="px-5 py-3.5 font-medium text-gray-400 uppercase tracking-wider text-[11px]">Duration</th>
                                    <th className="px-5 py-3.5 font-medium text-gray-400 uppercase tracking-wider text-[11px]">IP</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-800/50 max-h-full overflow-y-auto">
                                {logs.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} className="px-5 py-12 text-center text-gray-500">
                                            No traffic events found matching properties.
                                        </td>
                                    </tr>
                                ) : (
                                    logs.map(log => (
                                        <tr key={log.id} className="hover:bg-white/[0.02] transition-colors group">
                                            <td className="px-5 py-3 text-gray-400 font-mono text-xs">
                                                <span title={new Date(log.timestamp).toLocaleString()}>
                                                    {formatDistanceToNow(new Date(log.timestamp), { addSuffix: true })}
                                                </span>
                                            </td>
                                            <td className="px-5 py-3">
                                                <span className={`px-2 py-1 rounded-none text-[10px] font-bold uppercase tracking-widest ${methodColor(log.method)}`}>
                                                    {log.method}
                                                </span>
                                            </td>
                                            <td className="px-5 py-3 text-gray-200 truncate max-w-[250px]" title={log.path}>
                                                {log.path}
                                            </td>
                                            <td className="px-5 py-3">
                                                <span className={`px-2 py-1 rounded-none text-[10px] font-bold uppercase tracking-widest font-mono ${statusColor(log.status_code)}`}>
                                                    {log.status_code}
                                                </span>
                                            </td>
                                            <td className="px-5 py-3">
                                                {log.email ? (
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-gray-200">{log.email}</span>
                                                        {log.roles?.length > 0 && (
                                                            <Badge variant={log.roles.includes('admin') ? 'error' : 'outline'} className="text-[9px] py-0 px-1.5 h-4">
                                                                {log.roles[0]}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-gray-500 italic">anonymous</span>
                                                )}
                                            </td>
                                            <td className="px-5 py-3 font-mono text-xs text-gray-400">
                                                {log.duration_ms.toFixed(1)}ms
                                            </td>
                                            <td className="px-5 py-3 font-mono text-xs text-gray-500">
                                                {log.client_ip}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                    {nextCursor && (
                         <div className="bg-surface-800 border-t-2 border-surface-700 flex justify-center p-3">
                             <Button variant="secondary" onClick={() => loadLogs(true, false)} disabled={loading}>
                                 <ArrowDown className="mr-2 h-4 w-4" /> Load Older Logs
                             </Button>
                         </div>
                    )}
                </Card>
            )}
        </PageLayout>
    );
}
