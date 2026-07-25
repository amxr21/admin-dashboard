import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind classes, resolving conflicts by last-wins.
 *
 * `clsx` handles conditionals and arrays; `twMerge` then dedupes *conflicting*
 * utilities so a caller's override actually wins:
 *
 *   cn('px-4 py-2', 'px-6')        → 'py-2 px-6'   (not 'px-4 py-2 px-6')
 *   cn('bg-card', isActive && 'bg-primary')
 *
 * Plain `clsx` alone would emit both `px-4` and `px-6` and leave the winner to
 * CSS source order — which is why every shadcn component routes through this.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
