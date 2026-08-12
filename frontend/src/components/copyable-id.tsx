'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * An identifier: order number, RMA number, SKU, request ID.
 *
 * Three things every identifier in this app needs, applied in one place rather
 * than remembered per call site:
 *
 * 1. **Monospace + tabular figures.** Identifiers are compared by eye down a
 *    column, and a proportional font makes `ORD-1011` and `ORD-1077` the same
 *    width but different shapes.
 * 2. **`force-ltr`.** A code must not reorder in Arabic. `ORD-1024` rendered
 *    RTL can display as `1024-ORD`, which is a different string to anyone
 *    copying it by hand.
 * 3. **Copyable.** The realistic next action after reading an ID is pasting it
 *    into a search box, a ticket, or a message to a courier — and selecting
 *    text precisely inside a table cell is fiddly on every device.
 *
 * Falls back to plain text (still monospace, still LTR) when the clipboard is
 * unavailable — `navigator.clipboard` is undefined on insecure origins, so a
 * button that silently does nothing is worse than no button.
 */

interface CopyableIdProps {
  value: string;
  /** Rendered instead of `value` when the display form differs (e.g. `#1024`). */
  label?: string;
  className?: string;
}

export function CopyableId({ value, label, className }: CopyableIdProps) {
  const t = useTranslations('table');
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clearing on unmount matters: copy a value, navigate away before the 2s
  // window closes, and the callback would set state on a gone component.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const canCopy =
    typeof navigator !== 'undefined' && navigator.clipboard !== undefined;

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Permission can be refused even where the API exists. Staying silent is
      // right here — the value is still on screen to select by hand, and a
      // toast for a failed convenience action is noise.
    }
  }

  const text = (
    <span className="force-ltr font-mono text-sm tabular-nums">
      {label ?? value}
    </span>
  );

  if (!canCopy) {
    return <span className={className}>{text}</span>;
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      // Names the value, not just "copy" — a row of identical "Copy" buttons
      // is useless to a screen-reader user moving by control.
      aria-label={t(copied ? 'copied' : 'copyValue', { value })}
      className={cn(
        'group hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1.5 rounded-sm focus-visible:ring-2 focus-visible:outline-none',
        className,
      )}
    >
      {text}
      {copied ? (
        <Check className="size-3.5 shrink-0 text-(--color-success)" aria-hidden />
      ) : (
        // Hidden until hover/focus so a dense table isn't a wall of icons, but
        // never `hidden` — it must stay reachable by keyboard.
        <Copy
          className="text-muted-foreground size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          aria-hidden
        />
      )}
    </button>
  );
}
