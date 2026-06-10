import { useState, useEffect, lazy, Suspense } from 'react';
import { Sidebar } from './components/ui/Sidebar';
import type { ViewType } from './components/ui/Sidebar';
import { Topbar } from './components/ui/Topbar';
import { LoginScreen } from './components/ui/LoginScreen';
import { ShieldCheck } from 'lucide-react';

const OverviewView = lazy(() => import('./OverviewView'));
const SessionsView = lazy(() => import('./SessionsView'));
const TrafficView = lazy(() => import('./TrafficView'));
const UsersView = lazy(() => import('./UsersView'));
const PoliciesView = lazy(() => import('./PoliciesView'));
const PostureView = lazy(() => import('./PostureView'));
const RateLimitsView = lazy(() => import('./RateLimitsView'));
const ApiKeysView = lazy(() => import('./ApiKeysView'));

function ViewFallback() {
    return (
        <div className="flex h-full items-center justify-center">
            <div className="h-8 w-8 rounded-full border-2 border-brand-500/30 border-t-brand-500 animate-spin" />
        </div>
    );
}

export interface UserInfo {
    sub: string;
    email: string;
    roles: string[];
    jti: string;
}

export default function App() {
    const [view, setView] = useState<ViewType>('overview');
    const [user, setUser] = useState<UserInfo | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        fetch('/auth/me', { credentials: 'include', signal: controller.signal })
            .then(res => res.ok ? res.json() : null)
            .then(data => { if (data && data.email) setUser(data); else setUser(null); })
            .catch(() => setUser(null))
            .finally(() => { clearTimeout(timeout); setLoading(false); });
    }, []);

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center bg-slate-50">
                <div className="flex flex-col items-center gap-4">
                    <div className="relative">
                        <div className="h-12 w-12 rounded-2xl bg-brand-500 flex items-center justify-center">
                            <ShieldCheck className="h-6 w-6 text-white" />
                        </div>
                        <div className="absolute -inset-1 rounded-2xl border-2 border-brand-500/30 animate-ping" />
                    </div>
                    <p className="text-sm font-medium text-slate-500">Authenticating...</p>
                </div>
            </div>
        );
    }

    if (!user) {
        return <LoginScreen />;
    }

    return (
        <div className="flex h-screen overflow-hidden bg-slate-50 font-sans text-slate-900">
            <Sidebar currentView={view} onViewChange={setView} />

            <div className="flex flex-1 flex-col overflow-hidden min-w-0">
                <Topbar user={user} />

                <main className="flex-1 overflow-y-auto">
                    <Suspense fallback={<ViewFallback />}>
                        {(() => {
                            const isAdmin = user.roles.includes('admin');
                            return <>
                                {view === 'overview'   && <OverviewView />}
                                {view === 'traffic'    && <TrafficView />}
                                {view === 'sessions'   && <SessionsView isAdmin={isAdmin} />}
                                {view === 'users'      && <UsersView isAdmin={isAdmin} />}
                                {view === 'policies'   && <PoliciesView />}
                                {view === 'posture'    && <PostureView />}
                                {view === 'ratelimits' && <RateLimitsView />}
                                {view === 'apikeys'    && <ApiKeysView isAdmin={isAdmin} />}
                            </>;
                        })()}
                    </Suspense>
                </main>
            </div>
        </div>
    );
}
