import * as React from 'react';
import { cn } from '../../lib/utils';
import { Loader2 } from 'lucide-react';

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
    size?: 'default' | 'sm' | 'lg' | 'icon';
    isLoading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant = 'default', size = 'default', isLoading, children, ...props }, ref) => {
        const variants = {
            default: 'bg-brand-500 text-black hover:bg-brand-400 shadow-te-sm border-2 border-surface-950',
            destructive: 'bg-red-500 text-black hover:bg-red-400 shadow-te-sm border-2 border-surface-950',
            outline: 'bg-surface-900 text-white hover:bg-surface-800 shadow-te-sm border-2 border-surface-700',
            secondary: 'bg-surface-800 text-gray-200 hover:bg-surface-700 shadow-te-sm border-2 border-surface-950',
            ghost: 'hover:bg-surface-800 hover:text-white text-gray-400 border-2 border-transparent hover:border-surface-700 hover:shadow-te-sm',
            link: 'text-brand-500 underline-offset-4 hover:underline hover:bg-surface-900',
        };

        const sizes = {
            default: 'h-10 px-5 py-2',
            sm: 'h-8 px-3 text-xs',
            lg: 'h-12 px-8',
            icon: 'h-10 w-10',
        };

        return (
            <button
                ref={ref}
                disabled={isLoading || props.disabled}
                className={cn(
                    'inline-flex items-center justify-center rounded-none text-sm font-bold uppercase tracking-wider transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:pointer-events-none disabled:opacity-50 active:translate-y-[2px] active:translate-x-[2px] active:shadow-none',
                    variants[variant],
                    sizes[size],
                    className
                )}
                {...props}
            >
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin text-current" />}
                {children}
            </button>
        );
    }
);
Button.displayName = 'Button';

export { Button };
