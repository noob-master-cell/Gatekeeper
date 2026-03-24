import { useCallback, useEffect, useState } from 'react';
import type { Session } from './api';
import { fetchSessions, revokeAllUserSessions } from './api';
import { PageHeader, PageLayout } from './components/ui/PageLayout';
import { Button } from './components/ui/Button';
import { Badge } from './components/ui/Badge';
import { Card } from './components/ui/Card';
import { formatDistanceToNow } from 'date-fns';
import { Shield, Key, AlertCircle, RefreshCw, UserX } from 'lucide-react';

interface UserInfo {
    user_id: string;
    email: string;
    roles: string[];
    session_count: number;
    last_seen: string;
}

export default function UsersView() {
    const [users, setUsers] = useState<UserInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            setLoading(true);
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
                        existing.roles = s.roles;
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
        if (!confirm(`Revoke access for ${email}? They will be logged out of all active sessions immediately.`)) return;
        try {
            await revokeAllUserSessions(userId);
            await load();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Revocation failed');
        }
    };

    return (
        <PageLayout>
            <PageHeader
                title="Users"
                description={`${users.length} unique user${users.length !== 1 ? 's' : ''} with active sessions`}
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

            {users.length === 0 && !loading ? (
                <Card className="flex flex-col items-center justify-center py-20 bg-surface-900 border-2 border-surface-700 shadow-te">
                    <Shield className="h-12 w-12 text-surface-700 mb-4" />
                    <p className="text-white font-bold text-lg uppercase tracking-widest">No active users</p>
                    <p className="text-gray-500 text-sm mt-1 uppercase font-mono">There are no users with active sessions.</p>
                </Card>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {users.map(user => {
                        const isAdmin = user.roles.includes('admin');

                        return (
                            <Card
                                key={user.user_id}
                                className="group relative overflow-hidden bg-surface-900 border-gray-800 hover:border-gray-700 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300"
                            >
                                {/* Accent Top Border */}
                                <div className={`absolute top-0 left-0 w-full h-1 ${isAdmin ? 'bg-red-500/80' : user.roles.includes('hr') ? 'bg-amber-500/80' : 'bg-brand-500/80'}`} />

                                <div className="p-6">
                                    {/* Avatar + name */}
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-center gap-4">
                                            <div className="relative">
                                                <div className={`h-12 w-12 flex items-center justify-center text-black font-bold text-xl uppercase border-2 border-surface-950 shadow-te-sm
                                                  ${isAdmin ? 'bg-red-500' : 'bg-brand-500'}
                                                `}>
                                                    {user.email[0]}
                                                </div>
                                                {isAdmin && (
                                                    <div className="absolute -bottom-1 -right-1 bg-surface-900 border-2 border-surface-950 p-0.5">
                                                        <Shield className="h-4 w-4 text-red-500" />
                                                    </div>
                                                )}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-white font-bold text-base truncate uppercase tracking-widest" title={user.email}>{user.email}</p>
                                                <p className="text-xs text-brand-500 mt-1 font-mono truncate" title={user.user_id}>{user.user_id}</p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Roles */}
                                    <div className="flex flex-wrap gap-2 mt-5">
                                        {user.roles.map(role => (
                                            <Badge
                                                key={role}
                                                variant={role === 'admin' ? 'error' : role === 'hr' ? 'warning' : 'outline'}
                                            >
                                                {role}
                                            </Badge>
                                        ))}
                                    </div>

                                    {/* Stats */}
                                    <div className="flex items-center justify-between mt-6 pt-5 border-t border-gray-800/60">
                                        <div className="text-xs text-gray-400 flex flex-col gap-1">
                                            <div className="flex justify-between w-full gap-4">
                                                <span className="text-gray-500">Active Sessions</span>
                                                <span className="text-white font-medium flex items-center gap-1">
                                                    <Key className="h-3 w-3 text-brand-400" />
                                                    {user.session_count}
                                                </span>
                                            </div>
                                            <div className="flex justify-between w-full gap-4">
                                                <span className="text-gray-500">Last Seen</span>
                                                <span className="text-gray-300">
                                                    {formatDistanceToNow(new Date(user.last_seen), { addSuffix: true })}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Action Overlay */}
                                    <div className="absolute inset-x-0 bottom-0 bg-surface-800 border-t-2 border-surface-700 p-4 transform translate-y-full group-hover:translate-y-0 transition-transform duration-200 ease-in-out flex items-center justify-center">
                                        <Button
                                            variant="destructive"
                                            className="w-full shadow-te-sm"
                                            onClick={() => handleRevokeAll(user.user_id, user.email)}
                                        >
                                            <UserX className="mr-2 h-4 w-4" />
                                            Revoke_Access
                                        </Button>
                                    </div>
                                </div>
                            </Card>
                        );
                    })}
                </div>
            )}
        </PageLayout>
    );
}
