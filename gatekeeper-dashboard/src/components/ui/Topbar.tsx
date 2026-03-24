import { cn } from '../../lib/utils';
import { ShieldCheck, LogOut } from 'lucide-react';
import { Button } from './Button';
import type { UserInfo } from '../../App';

interface TopbarProps {
    user: UserInfo;
    className?: string;
}

export function Topbar({ user, className }: TopbarProps) {
    const handleLogout = () => { window.location.href = '/auth/logout'; };

    const initials = user.email.charAt(0).toUpperCase();
    const primaryRole = user.roles?.[0] ?? 'user';

    return (
        <header
            className={cn(
                'sticky top-0 z-40 flex h-16 w-full items-center justify-between border-b-2 border-surface-700 bg-surface-950 px-6',
                className
            )}
        >
            <div className="flex-1"></div>

            <div className="flex items-center gap-4">
                <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-emerald-500 text-black border-2 border-surface-950 shadow-te-sm text-[10px] uppercase font-bold tracking-widest">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Zero-Trust_Active
                </div>

                <div className="flex items-center gap-4 ml-2">
                    <div className="hidden md:flex flex-col items-end">
                        <span className="text-sm font-bold text-white uppercase tracking-wider leading-tight">{user.email}</span>
                        <span className="text-[10px] mt-0.5 text-brand-500 uppercase tracking-widest">{primaryRole}</span>
                    </div>

                    <div className="h-9 w-9 bg-brand-500 flex items-center justify-center text-black font-bold uppercase border-2 border-surface-950 shadow-te-sm">
                        {initials}
                    </div>

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
            </div>
        </header>
    );
}
