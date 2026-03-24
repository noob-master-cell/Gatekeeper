import * as React from 'react';
import { cn } from '../../lib/utils';
import {
    LayoutDashboard,
    Activity,
    KeyRound,
    Users,
    ChevronLeft,
    ShieldAlert,
    Smartphone
} from 'lucide-react';

export type ViewType = 'overview' | 'traffic' | 'sessions' | 'users' | 'policies' | 'posture';

interface SidebarProps {
    currentView: ViewType;
    onViewChange: (view: ViewType) => void;
    className?: string;
}

const NAV_ITEMS = [
    { id: 'overview' as const, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'traffic' as const, label: 'Live Traffic', icon: Activity },
    { id: 'sessions' as const, label: 'Sessions', icon: KeyRound },
    { id: 'users' as const, label: 'Users', icon: Users },
    { id: 'policies' as const, label: 'Policies', icon: ShieldAlert },
    { id: 'posture' as const, label: 'Device Posture', icon: Smartphone },
];

export function Sidebar({ currentView, onViewChange, className }: SidebarProps) {
    const [isCollapsed, setIsCollapsed] = React.useState(false);

    return (
        <aside
            className={cn(
                'relative flex flex-col border-r-2 border-surface-700 bg-surface-900 transition-all duration-300',
                isCollapsed ? 'w-20' : 'w-64',
                className
            )}
        >
            {/* Logo */}
            <div className="flex h-16 items-center border-b-2 border-surface-700 px-4">
                <div className="flex items-center gap-3 overflow-hidden ml-1">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center bg-brand-500 border-2 border-surface-950 shadow-te-sm">
                        <ShieldIcon className="h-4 w-4 text-black" />
                    </div>
                    {!isCollapsed && (
                        <div className="flex flex-col animate-in fade-in zoom-in-95 duration-200">
                            <span className="text-sm font-bold tracking-tight text-white uppercase mt-0.5">Gatekeeper</span>
                            <span className="text-[10px] font-bold text-surface-700 uppercase tracking-widest leading-none mt-1">Admin_Terminal</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Collapse Toggle */}
            <button
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="absolute -right-3 top-20 flex h-6 w-6 items-center justify-center border-2 border-surface-700 bg-surface-900 text-gray-400 shadow-te-sm hover:bg-surface-800 hover:text-white transition-all z-10 active:translate-y-[1px] active:shadow-none"
            >
                <ChevronLeft className={cn("h-3 w-3 transition-transform duration-200", isCollapsed && "rotate-180")} />
            </button>

            {/* Navigation */}
            <nav className="flex-1 space-y-1 p-3 overflow-y-auto">
                {NAV_ITEMS.map((item) => {
                    const isActive = currentView === item.id;
                    const Icon = item.icon;
                    return (
                        <button
                            key={item.id}
                            onClick={() => onViewChange(item.id)}
                            className={cn(
                                'group flex w-full items-center px-3 py-2.5 text-sm uppercase font-bold tracking-widest transition-all border-l-4',
                                isActive
                                    ? 'bg-surface-800 text-brand-500 border-brand-500'
                                    : 'text-gray-500 border-transparent hover:bg-surface-800 hover:text-gray-300 hover:border-surface-700',
                                isCollapsed ? 'justify-center px-0 border-l-0' : 'justify-start gap-4'
                            )}
                            title={isCollapsed ? item.label : undefined}
                        >
                            <Icon className={cn("h-5 w-5 shrink-0", isActive ? "text-brand-500" : "text-gray-600 group-hover:text-gray-400")} />
                            {!isCollapsed && <span>{item.label}</span>}

                            {/* Active Indicator Line */}
                            {isActive && !isCollapsed && (
                                <div className="ml-auto h-2 w-2 bg-brand-500 border border-surface-950" />
                            )}
                        </button>
                    );
                })}
            </nav>

        </aside>
    );
}

function ShieldIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            {...props}
        >
            <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
            <path d="m9 12 2 2 4-4" />
        </svg>
    );
}
