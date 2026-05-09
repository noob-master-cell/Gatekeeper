import * as React from 'react';
import { cn } from '../../lib/utils';
import { Loader2 } from 'lucide-react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
    size?: 'default' | 'sm' | 'lg' | 'icon';
    isLoading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant = 'default', size = 'default', isLoading, children, ...props }, ref) => {
        const variants = {
            default:     'bg-brand-500 text-white hover:bg-brand-600 shadow-sm border border-brand-600',
            destructive: 'bg-red-500 text-white hover:bg-red-600 shadow-sm border border-red-600',
            outline:     'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 shadow-sm',
            secondary:   'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200',
            ghost:       'text-slate-600 hover:bg-slate-100 hover:text-slate-900 border border-transparent',
            link:        'text-brand-500 underline-offset-4 hover:underline border-0 shadow-none',
        };

        const sizes = {
            default: 'h-9 px-4 py-2 text-sm',
            sm:      'h-8 px-3 text-xs',
            lg:      'h-11 px-6 text-sm',
            icon:    'h-9 w-9',
        };

        return (
            <button
                ref={ref}
                disabled={isLoading || props.disabled}
                className={cn(
                    'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50',
                    variants[variant],
                    sizes[size],
                    className
                )}
                {...props}
            >
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {children}
            </button>
        );
    }
);
Button.displayName = 'Button';

export { Button };
