import { useState, useEffect } from 'react';
import { cn } from '../../lib/utils';
import { ShieldCheck, LogIn, LogOut } from 'lucide-react';
import { Button } from './Button';

interface UserInfo {
    user_id: string;
    email: string;
    roles: string[];
}

export function Topbar({ className }: { className?: string }) {
    const [user, setUser] = useState<UserInfo | null>(null);

    useEffect(() => {
        fetch('/auth/me', { credentials: 'include' })
            .then(res => res.ok ? res.json() : null)
            .then(data => { if (data && data.email) setUser(data); })
            .catch(() => setUser(null));
    }, []);

    const handleLogin = () => { window.location.href = '/login'; };
    const handleLogout = () => { window.location.href = '/auth/logout'; };

    // Get initials from email
    const initials = user?.email
        ? user.email.charAt(0).toUpperCase()
        : '?';

    const primaryRole = user?.roles?.[0] ?? 'user';

    return (
        <header
            className={cn(
                'sticky top-0 z-40 flex h-16 w-full items-center justify-between border-b-2 border-surface-700 bg-surface-950 px-6',
                className
            )}
        >
            {/* Removed the search bar to keep the UI clean */}
            <div className="flex-1"></div>

            <div className="flex items-center gap-4">
                <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-emerald-500 text-black border-2 border-surface-950 shadow-te-sm text-[10px] uppercase font-bold tracking-widest">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Zero-Trust_Active
                </div>

                {user ? (
                    <div className="flex items-center gap-4 ml-2">
                        {/* User info */}
                        <div className="hidden md:flex flex-col items-end">
                            <span className="text-sm font-bold text-white uppercase tracking-wider leading-tight">{user.email}</span>
                            <span className="text-[10px] mt-0.5 text-brand-500 uppercase tracking-widest">{primaryRole}</span>
                        </div>

                        {/* Avatar */}
                        <div className="h-9 w-9 bg-brand-500 flex items-center justify-center text-black font-bold uppercase border-2 border-surface-950 shadow-te-sm">
                            {initials}
                        </div>

                        {/* Logout button */}
                        <Button
                            variant="destructive"
                            size="sm"
                            className="ml-2 gap-2"
                            onClick={handleLogout}
                        >
                            <LogOut className="h-4 w-4" />
                            <span className="hidden md:inline text-xs">Logout</span>
                        </Button>
                    </div>
                ) : (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-gray-400 hover:text-brand-400 gap-1.5"
                        onClick={handleLogin}
                    >
                        <LogIn className="h-4 w-4" />
                        <span className="text-xs">Sign In</span>
                    </Button>
                )}
            </div>
        </header>
    );
}
