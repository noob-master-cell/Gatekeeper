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
            const map = new Map<string, UserInfo>();
            sessions.forEach(s => {
                const existing = map.get(s.user_id);
                if (!existing) {
                    map.set(s.user_id, { user_id: s.user_id, email: s.email, roles: s.roles, session_count: 1, last_seen: s.created_at });
                } else {
                    existing.session_count++;
                    if (s.created_at > existing.last_seen) { existing.last_seen = s.created_at; existing.roles = s.roles; }
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
        if (!confirm(`Revoke all sessions for ${email}?`)) return;
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
                description={`${users.length} user${users.length !== 1 ? 's' : ''} with active sessions`}
                action={
                    <Button variant="outline" onClick={load} isLoading={loading} size="sm">
                        <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
                    </Button>
                }
            />

            {error && (
                <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                    <AlertCircle className="h-4 w-4 shrink-0" /> {error}
                </div>
            )}

            {users.length === 0 && !loading ? (
                <Card className="flex flex-col items-center justify-center py-20">
                    <Shield className="h-10 w-10 text-slate-300 mb-3" />
                    <p className="font-medium text-slate-600">No active users</p>
                    <p className="text-sm text-slate-400 mt-1">Users appear here when they have active sessions.</p>
                </Card>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {users.map(user => {
                        const isAdmin = user.roles.includes('admin');
                        const accentColor = isAdmin ? 'bg-red-500' : user.roles.includes('hr') ? 'bg-amber-500' : 'bg-brand-500';

                        return (
                            <Card key={user.user_id} className="group overflow-hidden hover:shadow-md transition-shadow relative">
                                {/* Top accent line */}
                                <div className={`h-1 w-full ${accentColor}`} />

                                <div className="p-5">
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="flex items-center gap-3">
                                            <div className="relative">
                                                <div className={`h-10 w-10 rounded-full flex items-center justify-center text-white text-sm font-semibold ${accentColor}`}>
                                                    {user.email[0].toUpperCase()}
                                                </div>
                                                {isAdmin && (
                                                    <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-white border border-slate-200 flex items-center justify-center">
                                                        <Shield className="h-2.5 w-2.5 text-red-500" />
                                                    </div>
                                                )}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-sm font-semibold text-slate-900 truncate max-w-[160px]" title={user.email}>{user.email}</p>
                                                <p className="text-[10px] text-slate-400 font-mono truncate" title={user.user_id}>{user.user_id}</p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap gap-1.5 mb-4">
                                        {user.roles.map(r => (
                                            <Badge key={r} variant={r === 'admin' ? 'error' : r === 'hr' ? 'warning' : 'outline'}>
                                                {r}
                                            </Badge>
                                        ))}
                                    </div>

                                    <div className="space-y-2 text-sm border-t border-slate-100 pt-3">
                                        <div className="flex justify-between items-center">
                                            <span className="text-slate-500 text-xs">Active sessions</span>
                                            <span className="text-slate-700 font-medium flex items-center gap-1">
                                                <Key className="h-3 w-3 text-brand-400" /> {user.session_count}
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-slate-500 text-xs">Last seen</span>
                                            <span className="text-slate-600 text-xs">{formatDistanceToNow(new Date(user.last_seen), { addSuffix: true })}</span>
                                        </div>
                                    </div>

                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="w-full mt-4 text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
                                        onClick={() => handleRevokeAll(user.user_id, user.email)}
                                    >
                                        <UserX className="mr-1.5 h-3.5 w-3.5" /> Revoke Access
                                    </Button>
                                </div>
                            </Card>
                        );
                    })}
                </div>
            )}
        </PageLayout>
    );
}
