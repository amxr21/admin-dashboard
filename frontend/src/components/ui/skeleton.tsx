import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * Loading placeholder.
 *
 * `animate-pulse` (opacity) rather than a translating shimmer, deliberately:
 * a shimmer sweeps in a fixed direction, so it travels the wrong way in RTL
 * unless mirrored with a second keyframe set. Opacity has no direction and is
 * cheaper to composite.
 *
 * `aria-hidden` because a screen reader should hear the loading STATE from a
 * live region, not read out a row of empty boxes. The container that swaps
 * skeleton for content owns `aria-busy`.
 */
function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn('bg-muted animate-pulse rounded-md', className)}
      {...props}
    />
  );
}

export { Skeleton };
