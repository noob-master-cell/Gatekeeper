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
        <div className={cn('flex items-center justify-between pb-6', className)}>
            <div className="space-y-1">
                <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>
                {description && (
                    <p className="text-sm text-gray-400">{description}</p>
                )}
            </div>
            {action && <div>{action}</div>}
        </div>
    );
}

export function PageLayout({
    children,
    className,
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={cn('flex-1 space-y-6 p-8 animate-in fade-in duration-500', className)}>
            {children}
        </div>
    );
}
