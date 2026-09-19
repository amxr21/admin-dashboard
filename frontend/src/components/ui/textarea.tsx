import type { ComponentProps } from 'react';

import { FIELD_SURFACE_BOX } from '@/components/ui/field-surface';
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
        // The box WITHOUT a height — a textarea sizes to its content, so it
        // takes `FIELD_SURFACE_BOX` rather than the `h-8` variant.
        FIELD_SURFACE_BOX,
        'flex field-sizing-content min-h-16 ps-3 pe-3 py-2 text-start',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
