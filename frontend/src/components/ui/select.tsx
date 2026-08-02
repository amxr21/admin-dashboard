'use client';

import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * Select.
 *
 * Replaces the native `<select>`, which cannot be styled consistently across
 * browsers or animated with the rest of the system, and whose dropdown escapes
 * the design language entirely on Windows.
 *
 * Radix handles RTL natively: the listbox aligns to the reading-start edge and
 * keyboard navigation reverses on its own. The chevron is NOT tagged
 * `.icon-directional` — it points down in both directions, since it indicates
 * "opens below", not a reading direction.
 */

const Select = SelectPrimitive.Root;
const SelectGroup = SelectPrimitive.Group;
const SelectValue = SelectPrimitive.Value;

function SelectTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        'border-input bg-background ring-offset-background placeholder:text-muted-foreground',
        'focus:ring-ring flex h-9 w-full items-center justify-between gap-2 rounded-md border',
        'px-3 py-2 text-sm focus:ring-2 focus:ring-offset-2 focus:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        // Matches the 200ms colour transition the rest of the system uses.
        'transition-colors',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-4 opacity-50" aria-hidden />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        className={cn(
          'bg-popover text-popover-foreground relative z-50 max-h-96 min-w-32 overflow-hidden',
          'rounded-md border shadow-md',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          position === 'popper' && 'data-[side=bottom]:translate-y-1',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport
          className={cn(
            'p-1',
            position === 'popper' && 'h-(--radix-select-trigger-height) w-full',
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        // Primary-tinted, not `--accent` (amber): a highlighted/focused
        // option is a candidate SELECTION, and "selected" reads as the
        // brand blue everywhere else in the app (sidebar active link,
        // calendar's selected day) — amber is reserved for actual emphasis,
        // not this.
        'focus:bg-primary/10 focus:text-primary relative flex w-full cursor-default',
        // ps/pe, not pl/pr — the check indicator sits on the reading-end side
        // and must move in Arabic.
        'items-center rounded-sm py-1.5 ps-2 pe-8 text-sm outline-none select-none',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute end-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-4" aria-hidden />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue };
