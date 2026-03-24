import { useCallback, useEffect, useState } from 'react';
import type { Session } from './api';
import { fetchSessions, killSession, revokeAllUserSessions } from './api';
import { PageHeader, PageLayout } from './components/ui/PageLayout';
import { Button } from './components/ui/Button';
import { Badge } from './components/ui/Badge';
import { Card } from './components/ui/Card';
import { formatDistanceToNow } from 'date-fns';
import { Shield, Key, Clock, Trash2, RefreshCw, AlertCircle } from 'lucide-react';

export default function SessionsView() {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetchSessions();
            setSessions(res);
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleKill = async (jti: string) => {
        if (!confirm('Kill this session?')) return;
        try {
            await killSession(jti);
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to kill session');
        }
    };

    const handleRevokeAll = async (userId: string, email: string) => {
        if (!confirm(`Revoke ALL sessions for ${email}?`)) return;
        try {
            await revokeAllUserSessions(userId);
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to revoke sessions');
        }
    };

    // Group by user
    const grouped = sessions.reduce((acc, s) => {
        if (!acc[s.user_id]) acc[s.user_id] = [];
        acc[s.user_id].push(s);
        return acc;
    }, {} as Record<string, Session[]>);

    return (
        <PageLayout>
            <PageHeader
                title="Active Sessions"
                description={`${sessions.length} active sessions across ${Object.keys(grouped).length} users`}
                action={
                    <Button variant="outline" onClick={load} isLoading={loading}>
                        <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </Button>
                }
            />

            {error && (
                <div className="flex items-center p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-300 text-sm">
                    <AlertCircle className="h-5 w-5 mr-3 flex-shrink-0" />
                    {error}
                </div>
            )}

            {Object.keys(grouped).length === 0 && !loading ? (
                <Card className="flex flex-col items-center justify-center py-20 bg-surface-900 border-2 border-surface-700 shadow-te">
                    <Key className="h-12 w-12 text-surface-700 mb-4" />
                    <p className="text-white font-bold text-lg uppercase tracking-widest">No active sessions</p>
                    <p className="text-gray-500 text-sm mt-1 uppercase font-mono">Users will appear here when they log in.</p>
                </Card>
            ) : (
                <div className="space-y-6">
                    {Object.entries(grouped).map(([userId, userSessions]) => {
                        const email = userSessions[0].email;
                        const roles = userSessions[0].roles;
                        const isAdmin = roles.includes('admin');

                        return (
                            <Card key={userId} className="overflow-hidden border-2 border-surface-700 bg-surface-900 shadow-te">
                                <div className="bg-surface-800 border-b-2 border-surface-700 px-6 py-4 flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="relative">
                                            <div className="h-12 w-12 bg-brand-500 border-2 border-surface-950 shadow-te-sm flex items-center justify-center text-black font-bold text-lg uppercase">
                                                {email[0]}
                                            </div>
                                            {isAdmin && (
                                                <div className="absolute -bottom-1 -right-1 bg-surface-900 border-2 border-surface-950 p-0.5">
                                                    <Shield className="h-4 w-4 text-brand-500" />
                                                </div>
                                            )}
                                        </div>
                                        <div>
                                            <h3 className="text-white font-bold text-base uppercase tracking-widest flex items-center gap-3">
                                                {email}
                                                <div className="flex gap-1.5">
                                                    {roles.map(r => (
                                                        <Badge key={r} variant={r === 'admin' ? 'error' : r === 'hr' ? 'warning' : 'outline'}>
                                                            {r}
                                                        </Badge>
                                                    ))}
                                                </div>
                                            </h3>
                                            <p className="text-xs text-brand-500 font-mono mt-1 tracking-wider">{userId}</p>
                                        </div>
                                    </div>
                                    <Button
                                        variant="destructive"
                                        onClick={() => handleRevokeAll(userId, email)}
                                    >
                                        Revoke All
                                    </Button>
                                </div>

                                <div className="divide-y divide-gray-800/50">
                                    {userSessions.map(s => (
                                        <div key={s.jti} className="flex items-center justify-between px-6 py-4 hover:bg-white/[0.02] transition-colors">
                                            <div className="flex items-center gap-6">
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Session ID (JTI)</span>
                                                    <span className="text-sm text-brand-500 font-mono font-bold bg-surface-950 px-2 py-1 border-2 border-surface-700 shadow-te-sm">{s.jti}</span>
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Created</span>
                                                    <span className="text-sm text-white font-mono flex items-center gap-1.5">
                                                        <Clock className="h-3.5 w-3.5 text-brand-500" />
                                                        {formatDistanceToNow(new Date(s.created_at), { addSuffix: true })}
                                                    </span>
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Expires In</span>
                                                    <span className="text-sm text-white font-mono">{Math.floor(s.ttl_seconds / 60)}m {s.ttl_seconds % 60}s</span>
                                                </div>
                                            </div>

                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => handleKill(s.jti)}
                                                className="text-gray-400 hover:text-red-400 hover:bg-red-500/10"
                                                title="Kill Session"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            </Card>
                        );
                    })}
                </div>
            )}
        </PageLayout>
    );
}
