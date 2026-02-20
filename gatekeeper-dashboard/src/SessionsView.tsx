import { useCallback, useEffect, useState } from 'react';
import type { Session } from './api';
import { fetchSessions, revokeAllUserSessions, revokeSession } from './api';

/** Active Sessions view — manage and revoke sessions. */
export default function SessionsView() {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [revoking, setRevoking] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const data = await fetchSessions();
            setSessions(data);
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleRevoke = async (jti: string) => {
        if (!confirm('Revoke this session? The user will be logged out.')) return;
        setRevoking(jti);
        try {
            await revokeSession(jti);
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Revocation failed');
        } finally {
            setRevoking(null);
        }
    };

    const handleRevokeAll = async (userId: string, email: string) => {
        if (!confirm(`Revoke ALL sessions for ${email}?`)) return;
        setRevoking(userId);
        try {
            const count = await revokeAllUserSessions(userId);
            alert(`Revoked ${count} session(s) for ${email}`);
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Revocation failed');
        } finally {
            setRevoking(null);
        }
    };

    // Group sessions by user
    const userMap = new Map<string, Session[]>();
    sessions.forEach(s => {
        const list = userMap.get(s.user_id) ?? [];
        list.push(s);
        userMap.set(s.user_id, list);
    });

    return (
        <div className="animate-fade-in">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-2xl font-semibold text-white">Active Sessions</h2>
                    <p className="text-sm text-gray-400 mt-1">
                        {sessions.length} active session{sessions.length !== 1 ? 's' : ''} across {userMap.size} user{userMap.size !== 1 ? 's' : ''}
                    </p>
                </div>
                <button
                    onClick={load}
                    className="px-4 py-2 rounded-lg bg-surface-800 text-gray-300 border border-gray-700 hover:border-gray-600 text-sm font-medium transition-all"
                >
                    ↻ Refresh
                </button>
            </div>

            {error && (
                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-300 text-sm">
                    {error}
                </div>
            )}

            {loading ? (
                <div className="text-center py-16 text-gray-500">
                    <div className="inline-block w-5 h-5 border-2 border-gray-600 border-t-brand-400 rounded-full animate-spin" />
                    <p className="mt-2">Loading sessions...</p>
                </div>
            ) : sessions.length === 0 ? (
                <div className="text-center py-16 text-gray-500 bg-surface-900 border border-gray-800 rounded-xl">
                    No active sessions
                </div>
            ) : (
                <div className="space-y-4">
                    {Array.from(userMap.entries()).map(([userId, userSessions]) => (
                        <div key={userId} className="bg-surface-900 border border-gray-800 rounded-xl overflow-hidden">
                            {/* User header */}
                            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-800 bg-white/[0.02]">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-brand-500/20 text-brand-300 flex items-center justify-center text-sm font-semibold">
                                        {userSessions[0].email[0].toUpperCase()}
                                    </div>
                                    <div>
                                        <p className="text-white font-medium text-sm">{userSessions[0].email}</p>
                                        <p className="text-xs text-gray-500">
                                            {userSessions[0].roles.join(', ')} · {userSessions.length} session{userSessions.length !== 1 ? 's' : ''}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleRevokeAll(userId, userSessions[0].email)}
                                    disabled={revoking === userId}
                                    className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 text-xs font-medium transition-all disabled:opacity-50"
                                >
                                    Revoke All
                                </button>
                            </div>

                            {/* Sessions list */}
                            <div className="divide-y divide-gray-800/50">
                                {userSessions.map(session => (
                                    <div key={session.jti} className="flex items-center justify-between px-5 py-3 hover:bg-white/[0.02] transition-colors">
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-mono text-gray-400 truncate">JTI: {session.jti}</p>
                                            <p className="text-xs text-gray-500 mt-0.5">
                                                Created: {new Date(session.created_at).toLocaleString()}
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => handleRevoke(session.jti)}
                                            disabled={revoking === session.jti}
                                            className="ml-4 px-3 py-1 rounded-md bg-gray-800 text-gray-400 border border-gray-700 hover:border-red-500/50 hover:text-red-400 text-xs font-medium transition-all disabled:opacity-50 shrink-0"
                                        >
                                            {revoking === session.jti ? '...' : 'Kill'}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
