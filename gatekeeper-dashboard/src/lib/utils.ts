import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge tailwind classes with proper overriding */
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
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
