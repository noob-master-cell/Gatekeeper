import * as React from 'react';
import { cn } from '../../lib/utils';

export function PageHeader({
    title,
    description,
    action,
    className,
}: {
    title: string;
    description?: string;
    action?: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={cn('flex items-start justify-between pb-6', className)}>
            <div className="space-y-1">
                <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
                {description && (
                    <p className="text-sm text-slate-500">{description}</p>
                )}
            </div>
            {action && <div className="flex-shrink-0 ml-4">{action}</div>}
        </div>
    );
}

export function PageLayout({ children, className }: { children: React.ReactNode; className?: string }) {
    return (
        <div className={cn('flex-1 space-y-6 p-6 md:p-8 animate-fade-in', className)}>
            {children}
        </div>
    );
}
