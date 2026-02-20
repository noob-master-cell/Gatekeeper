import { useCallback, useEffect, useState } from 'react';
import type { MetricsData } from './api';
import { fetchHealth, fetchMetrics } from './api';

interface HealthData {
    proxy: { status: string; version: string } | null;
    metrics: MetricsData | null;
}

/** Overview / Dashboard view — service health and stats. */
export default function OverviewView() {
    const [health, setHealth] = useState<HealthData>({ proxy: null, metrics: null });
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        try {
            const [proxyHealth, metrics] = await Promise.allSettled([fetchHealth(), fetchMetrics()]);
            setHealth({
                proxy: proxyHealth.status === 'fulfilled' ? proxyHealth.value : null,
                metrics: metrics.status === 'fulfilled' ? metrics.value : null,
            });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const cards = [
        {
            title: 'Proxy',
            status: health.proxy?.status ?? 'unknown',
            detail: `v${health.proxy?.version ?? '—'}`,
            color: health.proxy?.status === 'ok' ? 'emerald' : 'red',
        },
        {
            title: 'Version',
            status: health.metrics?.version ?? '—',
            detail: 'Current release',
            color: 'brand',
        },
        {
            title: 'Runtime',
            status: health.metrics?.uptime ?? '—',
            detail: health.metrics?.python_version?.split(' ')[0] ?? '—',
            color: 'amber',
        },
    ];

    const colorMap: Record<string, string> = {
        emerald: 'from-emerald-500/20 to-emerald-500/5 border-emerald-500/30 text-emerald-400',
        red: 'from-red-500/20 to-red-500/5 border-red-500/30 text-red-400',
        brand: 'from-brand-500/20 to-brand-500/5 border-brand-500/30 text-brand-400',
        amber: 'from-amber-500/20 to-amber-500/5 border-amber-500/30 text-amber-400',
    };

    return (
        <div className="animate-fade-in">
            <div className="mb-8">
                <h2 className="text-2xl font-semibold text-white">Dashboard</h2>
                <p className="text-sm text-gray-400 mt-1">Gatekeeper zero-trust infrastructure overview</p>
            </div>

            {loading ? (
                <div className="text-center py-16 text-gray-500">
                    <div className="inline-block w-5 h-5 border-2 border-gray-600 border-t-brand-400 rounded-full animate-spin" />
                    <p className="mt-2">Loading dashboard...</p>
                </div>
            ) : (
                <>
                    {/* Status cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                        {cards.map(card => (
                            <div
                                key={card.title}
                                className={`rounded-xl border p-5 bg-gradient-to-br ${colorMap[card.color]} transition-all hover:scale-[1.02]`}
                            >
                                <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">{card.title}</p>
                                <p className="text-2xl font-bold mt-2">{card.status}</p>
                                <p className="text-xs text-gray-500 mt-1">{card.detail}</p>
                            </div>
                        ))}
                    </div>

                    {/* Architecture diagram */}
                    <div className="bg-surface-900 border border-gray-800 rounded-xl p-6">
                        <h3 className="text-lg font-semibold text-white mb-4">Architecture</h3>
                        <div className="flex items-center justify-center gap-3 flex-wrap text-sm">
                            {[
                                { label: 'Client', icon: '🌐' },
                                { label: '→', icon: '' },
                                { label: 'Proxy :8000', icon: '🔒' },
                                { label: '→', icon: '' },
                                { label: 'Backend :8001', icon: '⚙️' },
                            ].map((item, i) => (
                                item.icon ? (
                                    <div key={i} className="flex flex-col items-center gap-1 px-4 py-3 bg-surface-800 rounded-lg border border-gray-700">
                                        <span className="text-xl">{item.icon}</span>
                                        <span className="text-gray-300 text-xs font-medium">{item.label}</span>
                                    </div>
                                ) : (
                                    <span key={i} className="text-gray-600 text-lg">→</span>
                                )
                            ))}
                        </div>
                        <div className="flex items-center justify-center gap-3 mt-3 text-sm">
                            <div className="flex flex-col items-center gap-1 px-4 py-3 bg-surface-800 rounded-lg border border-gray-700">
                                <span className="text-xl">🗄️</span>
                                <span className="text-gray-300 text-xs font-medium">PostgreSQL</span>
                            </div>
                            <div className="flex flex-col items-center gap-1 px-4 py-3 bg-surface-800 rounded-lg border border-gray-700">
                                <span className="text-xl">⚡</span>
                                <span className="text-gray-300 text-xs font-medium">Redis</span>
                            </div>
                            <div className="flex flex-col items-center gap-1 px-4 py-3 bg-surface-800 rounded-lg border border-gray-700">
                                <span className="text-xl">🛂</span>
                                <span className="text-gray-300 text-xs font-medium">Control Plane :8002</span>
                            </div>
                        </div>
                    </div>

                    {/* RBAC Policy */}
                    <div className="bg-surface-900 border border-gray-800 rounded-xl p-6 mt-4">
                        <h3 className="text-lg font-semibold text-white mb-4">RBAC Policy</h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-gray-800 text-gray-400 text-left">
                                        <th className="py-2 pr-4 font-medium">Route Pattern</th>
                                        <th className="py-2 pr-4 font-medium">Required Roles</th>
                                        <th className="py-2 font-medium">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="text-gray-300">
                                    {[
                                        { route: '/api/admin/*', roles: 'admin', action: '403 Forbidden' },
                                        { route: '/admin/*', roles: 'admin', action: '403 Forbidden' },
                                        { route: '/api/hr/*', roles: 'hr, admin', action: '403 Forbidden' },
                                        { route: '/* (default)', roles: 'Any authenticated', action: '401 Unauthorized' },
                                    ].map(row => (
                                        <tr key={row.route} className="border-b border-gray-800/50">
                                            <td className="py-2 pr-4 font-mono text-xs text-brand-300">{row.route}</td>
                                            <td className="py-2 pr-4">
                                                {row.roles.split(', ').map(r => (
                                                    <span key={r} className="inline-block px-2 py-0.5 bg-brand-500/10 text-brand-300 rounded text-xs mr-1">{r}</span>
                                                ))}
                                            </td>
                                            <td className="py-2 text-xs text-gray-400">{row.action}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
