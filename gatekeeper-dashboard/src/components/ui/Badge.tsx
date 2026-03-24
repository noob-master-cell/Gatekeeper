import * as React from 'react';
import { cn } from '../../lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
    variant?: 'default' | 'success' | 'warning' | 'error' | 'outline';
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
    const variants = {
        default: 'bg-surface-800 text-brand-500 border-surface-700',
        success: 'bg-emerald-500 text-black border-surface-950',
        warning: 'bg-amber-500 text-black border-surface-950',
        error: 'bg-red-500 text-black border-surface-950',
        outline: 'bg-transparent text-gray-300 border-surface-700',
    };

    return (
        <div
            className={cn(
                'inline-flex items-center rounded-none border-2 px-2.5 py-0.5 text-xs font-bold uppercase tracking-widest transition-colors',
                variants[variant],
                className
            )}
            {...props}
        />
    );
}
