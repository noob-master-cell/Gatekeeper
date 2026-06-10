import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge tailwind classes with proper overriding */
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

/** Extract a human-readable message from an unknown thrown value. */
export function errorMessage(err: unknown, fallback = 'Unknown error'): string {
    if (err instanceof Error) return err.message || fallback;
    if (typeof err === 'string') return err;
    return fallback;
}

/** Mask an email for demo/non-admin viewers: john@acme.com → j***@a***.com */
export function maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!domain) return '***';
    const dotIdx = domain.lastIndexOf('.');
    const domainName = dotIdx > 0 ? domain.slice(0, dotIdx) : domain;
    const tld = dotIdx > 0 ? domain.slice(dotIdx) : '';
    return `${local[0] ?? '*'}***@${domainName[0] ?? '*'}***${tld}`;
}
