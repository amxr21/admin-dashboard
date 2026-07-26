import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * Multi-line text input.
 *
 * A native `<textarea>` rather than a rich editor: it is a plain text box with
 * no browser-supplied chrome to fight, so the rule against native interactive
 * widgets (`<select>`, `<input type="date">`) doesn't apply here.
 *
 * Same logical properties as Input — `ps`/`pe`/`text-start`, never `pl`/`pr`.
 * `field-sizing-content` lets it grow with what's typed instead of forcing a
 * scrollbar inside a box the writer can't see out of.
 */
function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'border-input bg-card text-foreground placeholder:text-muted-foreground',
        'flex field-sizing-content min-h-16 w-full rounded-md border ps-3 pe-3 py-2 text-sm text-start',
        'transition-[color,box-shadow] outline-none',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
