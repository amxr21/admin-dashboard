'use client';

import * as LabelPrimitive from '@radix-ui/react-label';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * Form label.
 *
 * Radix's Label associates itself with the control via `htmlFor`, and also
 * forwards clicks to it — including for custom controls that aren't real
 * `<input>` elements, which a bare `<label>` does not do.
 */
function Label({
  className,
  ...props
}: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        'flex items-center gap-2 text-sm leading-none font-medium select-none',
        // Greys out with the control it labels, rather than staying black next
        // to a disabled field.
        'group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50',
        'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Label };
