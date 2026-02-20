import { useCallback, useEffect, useState } from 'react';
import type { Session } from './api';
import { fetchSessions, revokeAllUserSessions } from './api';

interface UserInfo {
    user_id: string;
    email: string;
    roles: string[];
    session_count: number;
    last_seen: string;
}

/** Users view — list users derived from active sessions. */
export default function UsersView() {
    const [users, setUsers] = useState<UserInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const sessions: Session[] = await fetchSessions();
            // Derive unique users from sessions
            const map = new Map<string, UserInfo>();
            sessions.forEach(s => {
                const existing = map.get(s.user_id);
                if (!existing) {
                    map.set(s.user_id, {
                        user_id: s.user_id,
                        email: s.email,
                        roles: s.roles,
                        session_count: 1,
                        last_seen: s.created_at,
                    });
                } else {
                    existing.session_count++;
                    if (s.created_at > existing.last_seen) {
                        existing.last_seen = s.created_at;
                        existing.roles = s.roles; // Use most recent roles
                    }
                }
            });
            setUsers(Array.from(map.values()));
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleRevokeAll = async (userId: string, email: string) => {
        if (!confirm(`Revoke ALL sessions for ${email}? They will be logged out.`)) return;
        try {
            const count = await revokeAllUserSessions(userId);
            alert(`Revoked ${count} session(s) for ${email}`);
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Revocation failed');
        }
    };

    const roleBadgeColor = (role: string) => {
        switch (role) {
            case 'admin': return 'bg-red-500/15 text-red-300 border-red-500/25';
            case 'hr': return 'bg-amber-500/15 text-amber-300 border-amber-500/25';
            default: return 'bg-brand-500/15 text-brand-300 border-brand-500/25';
        }
    };

    return (
        <div className="animate-fade-in">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-2xl font-semibold text-white">Users</h2>
                    <p className="text-sm text-gray-400 mt-1">
                        {users.length} user{users.length !== 1 ? 's' : ''} with active sessions
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
                    <p className="mt-2">Loading users...</p>
                </div>
            ) : users.length === 0 ? (
                <div className="text-center py-16 text-gray-500 bg-surface-900 border border-gray-800 rounded-xl">
                    No users with active sessions
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {users.map(user => (
                        <div
                            key={user.user_id}
                            className="bg-surface-900 border border-gray-800 rounded-xl p-5 hover:border-gray-700 transition-all"
                        >
                            {/* Avatar + name */}
                            <div className="flex items-start justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold text-sm">
                                        {user.email[0].toUpperCase()}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-white font-medium text-sm truncate">{user.email}</p>
                                        <p className="text-xs text-gray-500 mt-0.5 font-mono truncate">{user.user_id}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Roles */}
                            <div className="flex flex-wrap gap-1.5 mt-3">
                                {user.roles.map(role => (
                                    <span
                                        key={role}
                                        className={`px-2 py-0.5 rounded-full text-xs font-medium border ${roleBadgeColor(role)}`}
                                    >
                                        {role}
                                    </span>
                                ))}
                            </div>

                            {/* Stats */}
                            <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-800">
                                <div className="text-xs text-gray-400">
                                    <span className="text-white font-medium">{user.session_count}</span> session{user.session_count !== 1 ? 's' : ''}
                                    <span className="mx-2 text-gray-700">·</span>
                                    Last: {new Date(user.last_seen).toLocaleDateString()}
                                </div>
                                <button
                                    onClick={() => handleRevokeAll(user.user_id, user.email)}
                                    className="px-2.5 py-1 rounded-md bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 text-xs font-medium transition-all"
                                >
                                    Revoke
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
