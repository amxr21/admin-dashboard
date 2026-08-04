'use client';

import * as HoverCardPrimitive from '@radix-ui/react-hover-card';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * HoverCard — rich, hoverable preview content. Distinct from `Tooltip`
 * (`ui/tooltip.tsx`) on purpose: a Tooltip's content is plain text and must
 * never contain a focusable/interactive element (that's an accessibility
 * violation of the tooltip pattern — a screen reader has no way to reach
 * into it). HoverCard is the primitive actually designed for "icon + heading
 * + description + a link", which is why the sidebar's nav-item preview uses
 * this instead of stretching Tooltip past what it's for.
 *
 * Same fade + motion-safe zoom timing as Popover/Tooltip, so this doesn't
 * read as a third, different floating-surface motion language.
 */

const HoverCard = HoverCardPrimitive.Root;
const HoverCardTrigger = HoverCardPrimitive.Trigger;

function HoverCardContent({
  className,
  align = 'start',
  sideOffset = 8,
  ...props
}: ComponentProps<typeof HoverCardPrimitive.Content>) {
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Content
        data-slot="hover-card-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'bg-popover text-popover-foreground z-50 w-72 rounded-lg border p-4 shadow-md outline-none',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'motion-safe:data-[state=closed]:zoom-out-95 motion-safe:data-[state=open]:zoom-in-95',
          'duration-200',
          className,
        )}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  );
}

export { HoverCard, HoverCardTrigger, HoverCardContent };
