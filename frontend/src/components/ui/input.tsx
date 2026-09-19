import type { ComponentProps } from 'react';

import { FIELD_SURFACE } from '@/components/ui/field-surface';
import { cn } from '@/lib/utils';

/**
 * Text input.
 *
 * `text-start` and `ps-3`/`pe-3` rather than `text-left`/`pl-3`/`pr-3` — the
 * logical forms mirror automatically in RTL. This is the single most common
 * source of RTL bugs, so it matters even on a component this small.
 *
 * `type` is deliberately NOT defaulted to "text". Several types must render
 * LTR regardless of UI language (tel, email, url, password) — globals.css
 * targets them by selector, which only works if the caller passes a real type.
 */
function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // Border, fill, focus ring, invalid and disabled states are shared
        // with every other control — see ui/field-surface.ts. `h-8` comes
        // with it (URG-012), matching Button so a form row lines up.
        FIELD_SURFACE,
        // Layout is this control's own: logical padding, and `min-w-0` so a
        // flex parent can shrink it.
        'flex min-w-0 ps-3 pe-3 py-1 text-start',
        'file:text-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
