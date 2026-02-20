import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuditLog } from './api';
import { fetchAuditLogs } from './api';

/** Live traffic view — shows audit log events in real-time. */
export default function TrafficView() {
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const loadLogs = useCallback(async () => {
        try {
            const data = await fetchAuditLogs(200);
            setLogs(data);
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadLogs();
        if (autoRefresh) {
            intervalRef.current = setInterval(loadLogs, 3000);
        }
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [loadLogs, autoRefresh]);

    const statusColor = (code: number) => {
        if (code < 300) return 'text-emerald-400';
        if (code < 400) return 'text-blue-400';
        if (code < 500) return 'text-amber-400';
        return 'text-red-400';
    };

    const methodColor = (method: string) => {
        switch (method) {
            case 'GET': return 'bg-emerald-500/20 text-emerald-300';
            case 'POST': return 'bg-blue-500/20 text-blue-300';
            case 'PUT': return 'bg-amber-500/20 text-amber-300';
            case 'DELETE': return 'bg-red-500/20 text-red-300';
            default: return 'bg-gray-500/20 text-gray-300';
        }
    };

    return (
        <div className="animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-2xl font-semibold text-white">Live Traffic</h2>
                    <p className="text-sm text-gray-400 mt-1">
                        {logs.length} events · {autoRefresh ? 'Auto-refreshing' : 'Paused'}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setAutoRefresh(!autoRefresh)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${autoRefresh
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : 'bg-gray-800 text-gray-400 border border-gray-700 hover:border-gray-600'
                            }`}
                    >
                        <span className={`inline-block w-2 h-2 rounded-full mr-2 ${autoRefresh ? 'bg-emerald-400 animate-pulse-dot' : 'bg-gray-500'}`} />
                        {autoRefresh ? 'Live' : 'Paused'}
                    </button>
                    <button
                        onClick={loadLogs}
                        className="px-4 py-2 rounded-lg bg-surface-800 text-gray-300 border border-gray-700 hover:border-gray-600 text-sm font-medium transition-all"
                    >
                        ↻ Refresh
                    </button>
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-300 text-sm">
                    {error}
                </div>
            )}

            {/* Table */}
            <div className="bg-surface-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-800 text-gray-400 text-left">
                                <th className="py-3 px-4 font-medium">Time</th>
                                <th className="py-3 px-4 font-medium">Method</th>
                                <th className="py-3 px-4 font-medium">Path</th>
                                <th className="py-3 px-4 font-medium">Status</th>
                                <th className="py-3 px-4 font-medium">User</th>
                                <th className="py-3 px-4 font-medium">Duration</th>
                                <th className="py-3 px-4 font-medium">IP</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={7} className="py-12 text-center text-gray-500">
                                        <div className="inline-block w-5 h-5 border-2 border-gray-600 border-t-brand-400 rounded-full animate-spin" />
                                        <p className="mt-2">Loading traffic data...</p>
                                    </td>
                                </tr>
                            ) : logs.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="py-12 text-center text-gray-500">
                                        No traffic events yet. Make some requests!
                                    </td>
                                </tr>
                            ) : (
                                logs.map((log, i) => (
                                    <tr key={log.id || i} className="border-b border-gray-800/50 hover:bg-white/[0.02] transition-colors">
                                        <td className="py-2.5 px-4 text-gray-400 font-mono text-xs whitespace-nowrap">
                                            {new Date(log.timestamp).toLocaleTimeString()}
                                        </td>
                                        <td className="py-2.5 px-4">
                                            <span className={`px-2 py-0.5 rounded text-xs font-mono font-medium ${methodColor(log.method)}`}>
                                                {log.method}
                                            </span>
                                        </td>
                                        <td className="py-2.5 px-4 text-gray-200 font-mono text-xs max-w-48 truncate">{log.path}</td>
                                        <td className={`py-2.5 px-4 font-mono text-xs font-medium ${statusColor(log.status_code)}`}>
                                            {log.status_code}
                                        </td>
                                        <td className="py-2.5 px-4 text-gray-300 text-xs truncate max-w-36">{log.email}</td>
                                        <td className="py-2.5 px-4 text-gray-400 font-mono text-xs">{log.duration_ms}ms</td>
                                        <td className="py-2.5 px-4 text-gray-500 font-mono text-xs">{log.client_ip}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
