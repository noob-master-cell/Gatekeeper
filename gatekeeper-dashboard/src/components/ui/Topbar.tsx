import { cn } from '../../lib/utils';
import { LogOut, ChevronDown } from 'lucide-react';
import type { UserInfo } from '../../App';

interface TopbarProps {
    user: UserInfo;
    className?: string;
}

export function Topbar({ user, className }: TopbarProps) {
    const handleLogout = () => { window.location.href = '/auth/logout'; };
    const initials = user.email.charAt(0).toUpperCase();
    const primaryRole = user.roles?.[0] ?? 'user';

    const roleColor: Record<string, string> = {
        admin: 'bg-red-50 text-red-600 border-red-200',
        hr:    'bg-amber-50 text-amber-700 border-amber-200',
        user:  'bg-slate-100 text-slate-600 border-slate-200',
    };
    const roleCls = roleColor[primaryRole] ?? roleColor.user;

    return (
        <header
            className={cn(
                'sticky top-0 z-40 flex h-14 w-full items-center justify-between border-b border-slate-200 bg-white px-6',
                className
            )}
        >
            <div className="flex-1" />

            <div className="flex items-center gap-3">
                {/* Role pill */}
                <span className={`hidden md:inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${roleCls}`}>
                    {primaryRole}
                </span>

                {/* User info */}
                <div className="flex items-center gap-2 group cursor-default">
                    <div className="h-8 w-8 rounded-full bg-brand-500 flex items-center justify-center text-white text-sm font-semibold select-none">
                        {initials}
                    </div>
                    <div className="hidden md:flex flex-col leading-tight">
                        <span className="text-sm font-medium text-slate-900 truncate max-w-[160px]">{user.email}</span>
                    </div>
                    <ChevronDown className="h-3.5 w-3.5 text-slate-400 hidden md:block" />
                </div>

                {/* Separator */}
                <div className="h-5 w-px bg-slate-200 hidden md:block" />

                {/* Logout */}
                <button
                    onClick={handleLogout}
                    className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-900 transition-colors border border-transparent hover:border-slate-200"
                >
                    <LogOut className="h-4 w-4" />
                    <span className="hidden md:inline">Sign out</span>
                </button>
            </div>
        </header>
    );
}
