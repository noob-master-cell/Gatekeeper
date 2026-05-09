import * as React from 'react';
import { cn } from '../../lib/utils';
import {
    LayoutDashboard,
    Activity,
    KeyRound,
    Users,
    ChevronLeft,
    ShieldAlert,
    Smartphone,
    Gauge,
    ShieldCheck,
    Key,
} from 'lucide-react';

export type ViewType = 'overview' | 'traffic' | 'sessions' | 'users' | 'policies' | 'posture' | 'ratelimits' | 'apikeys';

interface SidebarProps {
    currentView: ViewType;
    onViewChange: (view: ViewType) => void;
    className?: string;
}

const NAV_ITEMS = [
    { id: 'overview'   as const, label: 'Dashboard',     icon: LayoutDashboard },
    { id: 'traffic'    as const, label: 'Live Traffic',   icon: Activity },
    { id: 'sessions'   as const, label: 'Sessions',       icon: KeyRound },
    { id: 'users'      as const, label: 'Users',          icon: Users },
    { id: 'policies'   as const, label: 'Policies',       icon: ShieldAlert },
    { id: 'posture'    as const, label: 'Device Posture', icon: Smartphone },
    { id: 'ratelimits' as const, label: 'Rate Limits',    icon: Gauge },
    { id: 'apikeys'    as const, label: 'API Keys',       icon: Key },
];

export function Sidebar({ currentView, onViewChange, className }: SidebarProps) {
    const [isCollapsed, setIsCollapsed] = React.useState(false);

    return (
        <aside
            className={cn(
                'relative flex flex-col border-r border-slate-200 bg-white transition-all duration-300',
                isCollapsed ? 'w-16' : 'w-60',
                className
            )}
        >
            {/* Logo */}
            <div className="flex h-14 items-center border-b border-slate-100 px-4">
                <div className="flex items-center gap-3 overflow-hidden">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-500">
                        <ShieldCheck className="h-4 w-4 text-white" />
                    </div>
                    {!isCollapsed && (
                        <div className="flex flex-col leading-tight">
                            <span className="text-sm font-semibold text-slate-900">Gatekeeper</span>
                            <span className="text-[10px] text-slate-400 font-medium">Admin Console</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Collapse Toggle */}
            <button
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="absolute -right-3 top-[3.25rem] flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-sm hover:bg-slate-50 hover:text-slate-600 transition-all z-10"
            >
                <ChevronLeft className={cn('h-3 w-3 transition-transform duration-200', isCollapsed && 'rotate-180')} />
            </button>

            {/* Navigation */}
            <nav className="flex-1 space-y-0.5 p-3 overflow-y-auto">
                {NAV_ITEMS.map((item) => {
                    const isActive = currentView === item.id;
                    const Icon = item.icon;
                    return (
                        <button
                            key={item.id}
                            onClick={() => onViewChange(item.id)}
                            className={cn(
                                'group flex w-full items-center rounded-md px-3 py-2 text-sm transition-all',
                                isActive
                                    ? 'bg-brand-50 text-brand-600 font-medium'
                                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                                isCollapsed ? 'justify-center px-2' : 'justify-start gap-3'
                            )}
                            title={isCollapsed ? item.label : undefined}
                        >
                            <Icon
                                className={cn(
                                    'h-4 w-4 shrink-0',
                                    isActive ? 'text-brand-500' : 'text-slate-400 group-hover:text-slate-600'
                                )}
                            />
                            {!isCollapsed && <span>{item.label}</span>}
                        </button>
                    );
                })}
            </nav>

            {/* Footer */}
            {!isCollapsed && (
                <div className="border-t border-slate-100 p-3">
                    <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-emerald-50">
                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse-dot" />
                        <span className="text-[10px] font-medium text-emerald-700 uppercase tracking-wide">
                            Zero-Trust Active
                        </span>
                    </div>
                </div>
            )}
        </aside>
    );
}
