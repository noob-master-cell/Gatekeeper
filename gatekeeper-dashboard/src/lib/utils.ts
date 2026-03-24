import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge tailwind classes with proper overriding */
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}
