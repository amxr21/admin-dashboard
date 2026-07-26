import type { ComponentProps } from 'react';

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
        'border-input bg-card text-foreground placeholder:text-muted-foreground',
        'flex h-9 w-full min-w-0 rounded-md border ps-3 pe-3 py-1 text-sm text-start',
        'transition-[color,box-shadow] outline-none',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        // aria-invalid, not a `error` prop: the attribute is what assistive
        // tech reads, so styling from it keeps the two from drifting apart.
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'file:text-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
