'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * Tooltip.
 *
 * `TooltipProvider` must wrap the app ONCE (see `[locale]/layout.tsx`) —
 * it's what makes a second tooltip open instantly (no re-delay) while the
 * pointer is still moving between triggers, and it centralises
 * `delayDuration` so every tooltip in the app opens after the same pause
 * rather than each call site guessing its own.
 *
 * `align` is Radix's LOGICAL prop (`"start"` means the reading-start edge in
 * both directions) — never pass `"left"`/`"right"` there. `side`, in
 * contrast, is a PHYSICAL edge of the trigger ('top' | 'right' | 'bottom' |
 * 'left'), not a logical one — a caller anchoring to a fixed rail (the
 * collapsed sidebar, for instance) must compute the direction-aware side
 * itself (see `getDocumentDirection()` in `lib/direction.ts`) rather than
 * assume this component flips it.
 *
 * Same fade, motion-safe zoom and 200ms-scale duration as Popover/
 * AlertDialog, so a tooltip doesn't feel like a different motion system
 * from the rest of the app's floating surfaces.
 */

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'bg-popover text-popover-foreground z-50 max-w-64 rounded-md border px-2.5 py-1.5 text-xs shadow-md',
          // Only `delayed-open` (the normal hover-and-wait case) animates in.
          // Radix's OTHER open state, `instant-open` (moving directly from one
          // trigger to the next inside the provider's grace period), is
          // deliberately left un-animated — the entire point of that state is
          // to feel immediate, and fading it in would undercut that.
          'data-[state=delayed-open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0',
          'motion-safe:data-[state=closed]:zoom-out-95 motion-safe:data-[state=delayed-open]:zoom-in-95',
          'duration-200',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
