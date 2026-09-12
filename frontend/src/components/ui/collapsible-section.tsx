'use client';

import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * A titled section that can be collapsed (URG-033).
 *
 * ─── WHY NOT A RADIX ACCORDION ───────────────────────────────────────
 * This repo already collapses a region in `diagnostics-bar.tsx` with a plain
 * `<button aria-expanded>` toggling local state, and that is all the pattern
 * needs: one independent disclosure per section, no single-open constraint, no
 * roving focus between items. Pulling in `@radix-ui/react-accordion` would add
 * a dependency to reproduce a `useState` and two ARIA attributes, and would
 * introduce a SECOND disclosure idiom alongside the one already here.
 *
 * ─── ACCESSIBILITY ───────────────────────────────────────────────────
 * The heading stays a real `<h2>` so the page keeps its document outline for a
 * screen reader; the button lives INSIDE it rather than replacing it, which is
 * the shape the WAI-ARIA disclosure pattern asks for. `aria-controls` points at
 * the region, and the region is hidden with the `hidden` attribute rather than
 * `display:none` via a class, so assistive tech and in-page find both agree it
 * is not there.
 *
 * ─── WHY IT DEFAULTS TO OPEN ─────────────────────────────────────────
 * Collapsing is for getting a long order page under control, not for hiding
 * information by default. A section that starts closed makes a reader hunt for
 * content that used to be visible, so every section opens as it always did and
 * the reader chooses what to fold away.
 */

interface CollapsibleSectionProps {
  title: ReactNode;
  children: ReactNode;
  /** Starts open unless a caller has a specific reason to fold it away. */
  defaultOpen?: boolean;
  /** Rendered next to the title, e.g. a count or a status badge. */
  aside?: ReactNode;
  /**
   * An interactive control for the section as a whole — a group-enable switch
   * (URG-026/031), say.
   *
   * Rendered as a SIBLING of the toggle button, never inside it: a button or
   * checkbox nested in a button is invalid HTML, and the inner control would
   * be unreachable by keyboard because the outer button swallows the events.
   * `aside` is for inert text; anything clickable belongs here.
   */
  action?: ReactNode;
  className?: string;
  /**
   * Replaces the body's default `p-4`. For full-bleed content — a table that
   * spans edge to edge, or rows carrying their own padding — where an inset
   * would misalign it against the header above.
   */
  bodyClassName?: string;
}

export function CollapsibleSection({
  title,
  children,
  defaultOpen = true,
  aside,
  action,
  className,
  bodyClassName,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const regionId = useId();

  return (
    <section className={cn('bg-card rounded-lg border', className)}>
      <div className={cn('flex items-center', isOpen && 'border-b')}>
      <h2 className="min-w-0 flex-1 font-medium">
        <button
          type="button"
          onClick={() => setIsOpen((current) => !current)}
          aria-expanded={isOpen}
          aria-controls={regionId}
          className={cn(
            'flex w-full items-center gap-2 px-4 py-3 text-start',
            'focus-visible:ring-ring rounded-lg focus-visible:ring-2 focus-visible:outline-none',
          )}
        >
          <ChevronDown
            aria-hidden
            className={cn(
              'text-muted-foreground size-4 shrink-0 transition-transform duration-200',
              'motion-reduce:transition-none',
              // Rotates rather than swapping glyphs, so the control reads as
              // one thing changing state. -90deg (not +90) points the closed
              // chevron toward the reading-start edge in LTR; the RTL variant
              // mirrors it, since a disclosure arrow DOES indicate direction.
              !isOpen && '-rotate-90 rtl:rotate-90',
            )}
          />
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {aside ? <span className="text-muted-foreground text-sm">{aside}</span> : null}
        </button>
      </h2>
      {action ? <div className="shrink-0 pe-4">{action}</div> : null}
      </div>

      <div id={regionId} hidden={!isOpen} className={bodyClassName ?? 'p-4'}>
        {children}
      </div>
    </section>
  );
}
