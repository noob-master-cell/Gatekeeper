import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from './api';
import { fetchSessions, killSession, revokeAllUserSessions } from './api';
import { PageHeader, PageLayout } from './components/ui/PageLayout';
import { Button } from './components/ui/Button';
import { Badge } from './components/ui/Badge';
import { Card } from './components/ui/Card';
import { formatDistanceToNow } from 'date-fns';
import { Shield, Key, Clock, Trash2, RefreshCw, AlertCircle, CheckCircle, XCircle, ShieldOff } from 'lucide-react';
import { maskEmail } from './lib/utils';

interface Toast { id: number; message: string; ok: boolean; }
let toastId = 0;

export default function SessionsView({ isAdmin = false }: { isAdmin?: boolean }) {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [toasts, setToasts] = useState<Toast[]>([]);
    const [confirmKill, setConfirmKill] = useState<string | null>(null);
    const [confirmRevokeAll, setConfirmRevokeAll] = useState<{ userId: string; email: string } | null>(null);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const toastTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

    useEffect(() => {
        const timers = toastTimers.current;
        return () => { timers.forEach(clearTimeout); };
    }, []);

    const addToast = (message: string, ok: boolean) => {
        const id = ++toastId;
        setToasts(t => [...t, { id, message, ok }]);
        const timer = setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
        toastTimers.current.push(timer);
    };

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
        if (confirmKill !== jti) { setConfirmKill(jti); return; }
        setConfirmKill(null);
        setActionLoading(jti);
        try {
            await killSession(jti);
            addToast('Session terminated', true);
            await load();
        } catch (e) {
            addToast(e instanceof Error ? e.message : 'Failed to kill session', false);
        } finally {
            setActionLoading(null);
        }
    };

    const handleRevokeAll = async (userId: string, email: string) => {
        if (!confirmRevokeAll || confirmRevokeAll.userId !== userId) { setConfirmRevokeAll({ userId, email }); return; }
        setConfirmRevokeAll(null);
        setActionLoading(`revoke:${userId}`);
        try {
            const count = await revokeAllUserSessions(userId);
            addToast(`Revoked ${count} session${count !== 1 ? 's' : ''} for ${email}`, true);
            await load();
        } catch (e) {
            addToast(e instanceof Error ? e.message : 'Failed to revoke sessions', false);
        } finally {
            setActionLoading(null);
        }
    };

    const grouped = sessions.reduce((acc, s) => {
        if (!acc[s.user_id]) acc[s.user_id] = [];
        acc[s.user_id].push(s);
        return acc;
    }, {} as Record<string, Session[]>);

    return (
        <PageLayout>
            {/* Toasts */}
            <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
                {toasts.map(t => (
                    <div key={t.id} className={`pointer-events-auto flex items-center gap-2.5 px-4 py-3 rounded-xl border text-sm font-medium shadow-lg animate-in slide-in-from-right-4 ${t.ok ? 'bg-white border-emerald-200 text-emerald-700' : 'bg-white border-red-200 text-red-700'}`}>
                        {t.ok ? <CheckCircle className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
                        {t.message}
                    </div>
                ))}
            </div>

            <PageHeader
                title="Active Sessions"
                description={`${sessions.length} sessions · ${Object.keys(grouped).length} users`}
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

            {confirmRevokeAll && (
                <div className="flex flex-wrap items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm">
                    <ShieldOff className="h-4 w-4 shrink-0" />
                    <span>Revoke <strong>all sessions</strong> for <strong>{confirmRevokeAll.email}</strong>? They'll be signed out immediately.</span>
                    <div className="ml-auto flex gap-2">
                        <Button size="sm" variant="destructive" isLoading={actionLoading === `revoke:${confirmRevokeAll.userId}`}
                            onClick={() => handleRevokeAll(confirmRevokeAll!.userId, confirmRevokeAll!.email)}>
                            Confirm
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmRevokeAll(null)}>Cancel</Button>
                    </div>
                </div>
            )}

            {Object.keys(grouped).length === 0 && !loading ? (
                <Card className="flex flex-col items-center justify-center py-20">
                    <Key className="h-10 w-10 text-slate-300 mb-3" />
                    <p className="font-medium text-slate-600">No active sessions</p>
                    <p className="text-sm text-slate-400 mt-1">Users will appear here when they log in.</p>
                </Card>
            ) : (
                <div className="space-y-4">
                    {Object.entries(grouped).map(([userId, userSessions]) => {
                        const { email, roles } = userSessions[0];
                        const isRowAdmin = roles.includes('admin');
                        const isRevokingAll = actionLoading === `revoke:${userId}`;

                        return (
                            <Card key={userId} className="overflow-hidden">
                                {/* User header */}
                                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50/60">
                                    <div className="flex items-center gap-3">
                                        <div className="relative">
                                            <div className={`h-9 w-9 rounded-full flex items-center justify-center text-white text-sm font-semibold ${isRowAdmin ? 'bg-red-500' : 'bg-brand-500'}`}>
                                                {email[0].toUpperCase()}
                                            </div>
                                            {isRowAdmin && (
                                                <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-white border border-slate-200 flex items-center justify-center">
                                                    <Shield className="h-2.5 w-2.5 text-red-500" />
                                                </div>
                                            )}
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-semibold text-slate-900">
                                                    {isAdmin ? email : maskEmail(email)}
                                                </span>
                                                <div className="flex gap-1">
                                                    {roles.map(r => (
                                                        <Badge key={r} variant={r === 'admin' ? 'error' : r === 'hr' ? 'warning' : 'outline'} className="text-[10px]">{r}</Badge>
                                                    ))}
                                                </div>
                                            </div>
                                            <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                                                {isAdmin ? userId : userId.slice(0, 8) + '••••'}
                                            </p>
                                        </div>
                                    </div>
                                    {isAdmin && (
                                        <Button
                                            variant={confirmRevokeAll?.userId === userId ? 'destructive' : 'outline'}
                                            size="sm"
                                            isLoading={isRevokingAll}
                                            onClick={() => handleRevokeAll(userId, email)}
                                        >
                                            {confirmRevokeAll?.userId === userId ? 'Confirm?' : 'Revoke All'}
                                        </Button>
                                    )}
                                </div>

                                {/* Sessions */}
                                <div className="divide-y divide-slate-100">
                                    {userSessions.map(s => {
                                        const isKilling = actionLoading === s.jti;
                                        const needsConfirm = confirmKill === s.jti;
                                        return (
                                            <div key={s.jti} className="flex items-center justify-between px-5 py-3.5 hover:bg-slate-50/60 transition-colors">
                                                <div className="flex flex-wrap items-center gap-6">
                                                    <div>
                                                        <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide mb-1">Session JTI</p>
                                                        <span className="text-xs text-brand-600 font-mono bg-brand-50 px-2 py-0.5 rounded-md border border-brand-100">{s.jti}</span>
                                                    </div>
                                                    <div>
                                                        <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide mb-1">Created</p>
                                                        <span className="text-xs text-slate-600 flex items-center gap-1">
                                                            <Clock className="h-3 w-3 text-slate-400" />
                                                            {formatDistanceToNow(new Date(s.created_at), { addSuffix: true })}
                                                        </span>
                                                    </div>
                                                    <div>
                                                        <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide mb-1">Expires</p>
                                                        <span className="text-xs text-slate-600">{Math.floor(s.ttl_seconds / 60)}m {s.ttl_seconds % 60}s</span>
                                                    </div>
                                                </div>

                                                {isAdmin && (
                                                    <div className="flex items-center gap-2">
                                                        {needsConfirm && (
                                                            <span className="text-xs text-red-500">Click again to confirm</span>
                                                        )}
                                                        <Button
                                                            variant={needsConfirm ? 'destructive' : 'ghost'}
                                                            size="icon"
                                                            isLoading={isKilling}
                                                            onClick={() => handleKill(s.jti)}
                                                            className={needsConfirm ? '' : 'text-slate-400 hover:text-red-500 hover:bg-red-50'}
                                                        >
                                                            {!isKilling && <Trash2 className="h-4 w-4" />}
                                                        </Button>
                                                        {needsConfirm && (
                                                            <Button variant="ghost" size="sm" onClick={() => setConfirmKill(null)} className="text-slate-500">
                                                                Cancel
                                                            </Button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </Card>
                        );
                    })}
                </div>
            )}
        </PageLayout>
    );
}
