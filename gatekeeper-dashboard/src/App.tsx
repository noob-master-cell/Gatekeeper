import { useState, useEffect } from 'react';
import OverviewView from './OverviewView';
import SessionsView from './SessionsView';
import TrafficView from './TrafficView';
import UsersView from './UsersView';
import PoliciesView from './PoliciesView';
import PostureView from './PostureView';
import { Sidebar } from './components/ui/Sidebar';
import type { ViewType } from './components/ui/Sidebar';
import { Topbar } from './components/ui/Topbar';
import { LoginScreen } from './components/ui/LoginScreen';

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
        fetch('/auth/me', { credentials: 'include' })
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                if (data && data.email) setUser(data);
                else setUser(null);
            })
            .catch(() => setUser(null))
            .finally(() => setLoading(false));
    }, []);

    if (loading) {
        return (
            <div className="flex h-screen items-center justify-center bg-surface-950">
                <div className="flex flex-col items-center gap-4">
                    <div className="h-10 w-10 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm font-bold uppercase tracking-widest text-surface-700">Authenticating...</span>
                </div>
            </div>
        );
    }

    if (!user) {
        return <LoginScreen />;
    }

    return (
        <div className="flex h-screen overflow-hidden bg-surface-950 font-sans text-gray-100">
            <Sidebar currentView={view} onViewChange={setView} />

            <div className="flex flex-1 flex-col overflow-hidden">
                <Topbar user={user} />

                <main className="flex-1 overflow-y-auto">
                    {view === 'overview' && <OverviewView />}
                    {view === 'traffic' && <TrafficView />}
                    {view === 'sessions' && <SessionsView />}
                    {view === 'users' && <UsersView />}
                    {view === 'policies' && <PoliciesView />}
                    {view === 'posture' && <PostureView />}
                </main>
            </div>
        </div>
    );
}
