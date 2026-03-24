import * as React from 'react';
import { cn } from '../../lib/utils';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> { }

export function Card({ className, ...props }: CardProps) {
    return (
        <div
            className={cn(
                'rounded-none border-2 border-surface-700 bg-surface-900 shadow-te transition-all duration-200',
                className
            )}
            {...props}
        />
    );
}

export function CardHeader({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            className={cn('flex flex-col space-y-1.5 p-6', className)}
            {...props}
        />
    );
}

export function CardTitle({
    className,
    ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
    return (
        <h3
            className={cn(
                'text-lg font-semibold leading-none tracking-tight text-white',
                className
            )}
            {...props}
        />
    );
}

export function CardDescription({
    className,
    ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
    return (
        <p
            className={cn('text-sm text-gray-400', className)}
            {...props}
        />
    );
}

export function CardContent({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div className={cn('p-6 pt-0', className)} {...props} />
    );
}

export function CardFooter({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            className={cn('flex items-center p-6 pt-0', className)}
            {...props}
        />
    );
}
