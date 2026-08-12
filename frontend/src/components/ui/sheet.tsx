'use client';

import * as SheetPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * Slide-over panel. Used for the mobile navigation drawer.
 *
 * ─── RTL: POSITION BY `start-*`/`end-*`, ANIMATE BY `rtl:`/`ltr:` ────
 * The PANEL'S RESTING POSITION is set with Tailwind's logical inset utilities
 * (`start-*`/`end-*`, mirroring `ps-*`/`pe-*`) — see the note further down
 * about why `inset-inline-start-*` is NOT the same thing and generates no CSS
 * at all.
 *
 * The ENTRANCE ANIMATION is a real `translateX` slide, which — unlike inset —
 * genuinely does ignore `dir="rtl"` on its own (a transform has no concept of
 * logical direction). So the slide direction is chosen explicitly with
 * Tailwind's `rtl:`/`ltr:` variants (verified compiling to
 * `:where(:dir(rtl), [dir="rtl"], [dir="rtl"] *)` — a real, working selector,
 * not a guess) rather than left to the transform to figure out on its own.
 * `side="start"` slides from the left in LTR / right in RTL; `side="end"` is
 * the mirror of that — matching whichever edge `start-0`/`end-0` anchors it
 * to, so the slide direction and the resting position never disagree.
 *
 * `motion-safe:` gates the slide (and the modal variant's zoom) so
 * `prefers-reduced-motion: reduce` gets a plain cross-fade only — no travel,
 * per this app's motion rule (see `motion-tokens.ts`'s `REDUCED` comment):
 * reduced motion means no travel, not no transition at all.
 *
 * NOTE: this used to read `inset-inline-start-0` etc. for POSITION — those
 * look like real CSS logical-property names but are NOT Tailwind's utility
 * names for them (Tailwind's own vocabulary is the shorter `start-*`/`end-*`),
 * so they silently generated zero CSS. Every drawer in the app was invisible,
 * positioned at its default document-flow spot, until this was caught by
 * treating a user bug report as real and verifying in an actual browser
 * rather than trusting component tests (which mock enough that the missing
 * CSS never showed up). If you add a new logical-position utility anywhere,
 * confirm it in the compiled CSS output, not just by how the class name reads.
 */

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;

function SheetOverlay({
  className,
  ...props
}: ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-black/50',
        'data-[state=open]:animate-in data-[state=open]:fade-in-0',
        'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
        className,
      )}
      {...props}
    />
  );
}

interface SheetContentProps extends ComponentProps<typeof SheetPrimitive.Content> {
  /** Logical edge. 'start' is left in LTR, right in RTL. Ignored when variant is 'modal'. */
  side?: 'start' | 'end';
  /**
   * 'drawer' (default): the slide-over panel described above.
   * 'modal': a centered dialog — same Radix Dialog primitive and overlay,
   * just positioned and sized differently. Driven by `ui.editPanelMode`; see
   * resource-form.tsx for the only current consumer. Named to match that
   * setting's own vocabulary, not a new one.
   */
  variant?: 'drawer' | 'modal';
  title: string;
  /** Visually hidden but read by screen readers if no visible description. */
  description?: string;
}

function SheetContent({
  className,
  children,
  side = 'start',
  variant = 'drawer',
  title,
  description,
  ...props
}: SheetContentProps) {
  return (
    <SheetPrimitive.Portal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          'bg-card fixed z-50 flex flex-col gap-4 shadow-lg',
          variant === 'modal'
            ? // Centering via translate is direction-agnostic (unlike a slide-in
              // translateX, which is NOT — see the RTL note above), so this is
              // safe to do with a physical transform in both directions.
              // `w-[calc(100%-2rem)]` keeps a gutter on small screens so the
              // dialog never runs edge to edge; `max-w-lg` caps it on large
              // ones. `min-h-0` lets a consumer's own flex child scroll instead
              // of overflowing past the 85vh cap — without it a nested
              // `flex-1` region refuses to shrink below its content height.
              'top-1/2 left-1/2 max-h-[85vh] min-h-0 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border p-4'
            : cn(
                // Block axis never flips with direction, so plain physical
                // top/bottom is correct here — there is no "inset-block-*"
                // Tailwind utility (that name doesn't exist; Tailwind's own
                // logical utilities are `start-*`/`end-*`, mirroring `ps-*`/
                // `pe-*`), and it silently generated no CSS at all.
                'top-0 bottom-0 h-full min-h-0 w-3/4 max-w-sm border-e p-4',
                // Anchored logically via Tailwind's real `start-*`/`end-*`
                // inset utilities — mirrors automatically, no transform.
                side === 'start' ? 'start-0' : 'end-0 border-s border-e-0',
              ),
          'data-[state=open]:animate-in data-[state=open]:fade-in-0',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          variant === 'modal'
            ? // A "pop" — the standard shadcn Dialog treatment: fade + a
              // slight scale, growing from/shrinking to the centered point.
              cn(
                'motion-safe:data-[state=open]:zoom-in-95',
                'motion-safe:data-[state=closed]:zoom-out-95',
              )
            : // A real slide, direction picked explicitly by `rtl:`/`ltr:` so
              // it never depends on a bare transform to "know" the reading
              // direction — see the file header note.
              cn(
                side === 'start'
                  ? cn(
                      'motion-safe:ltr:data-[state=open]:slide-in-from-left',
                      'motion-safe:ltr:data-[state=closed]:slide-out-to-left',
                      'motion-safe:rtl:data-[state=open]:slide-in-from-right',
                      'motion-safe:rtl:data-[state=closed]:slide-out-to-right',
                    )
                  : cn(
                      'motion-safe:ltr:data-[state=open]:slide-in-from-right',
                      'motion-safe:ltr:data-[state=closed]:slide-out-to-right',
                      'motion-safe:rtl:data-[state=open]:slide-in-from-left',
                      'motion-safe:rtl:data-[state=closed]:slide-out-to-left',
                    ),
              ),
          'duration-300',
          className,
        )}
        {...props}
      >
        {/* Radix requires a Title for the dialog to be announced. Visually
            hidden when the consumer renders its own heading. */}
        <SheetPrimitive.Title className="sr-only">{title}</SheetPrimitive.Title>
        {description ? (
          <SheetPrimitive.Description className="sr-only">
            {description}
          </SheetPrimitive.Description>
        ) : null}

        {children}

        <SheetPrimitive.Close
          className={cn(
            'absolute top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100',
            'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
            variant === 'modal'
              ? 'end-4'
              : // The close button follows the panel's far edge, so it mirrors too.
                side === 'start'
                ? 'end-4'
                : 'start-4',
          )}
        >
          {/* An X is symmetric — never .icon-directional. */}
          <X className="size-4" aria-hidden />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetOverlay };
