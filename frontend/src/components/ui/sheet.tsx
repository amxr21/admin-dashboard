'use client';

import * as SheetPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * Slide-over panel. Used for the mobile navigation drawer.
 *
 * ─── RTL: WHY inset-inline-* AND NOT translateX ──────────────────────
 * CSS transforms ignore `dir="rtl"`, so `translateX(-100%)` slides left in
 * both directions — a drawer that enters correctly in English slides OFF
 * SCREEN in Arabic, silently.
 *
 * Tailwind's `data-[state=open]:slide-in-from-left` compiles to exactly that
 * transform, so it is NOT used here. Positioning by `inset-inline-start` and
 * animating opacity/visibility instead means the panel is anchored to the
 * reading-start edge in both directions with no direction maths at all.
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
              'top-1/2 left-1/2 max-h-[85vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border p-4'
            : cn(
                'inset-block-0 h-full w-3/4 max-w-sm border-e p-4',
                // Anchored logically — mirrors automatically, no transform involved.
                side === 'start'
                  ? 'inset-inline-start-0'
                  : 'inset-inline-end-0 border-s border-e-0',
              ),
          'transition-opacity duration-200',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
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
              ? 'inset-inline-end-4'
              : // The close button follows the panel's far edge, so it mirrors too.
                side === 'start'
                ? 'inset-inline-end-4'
                : 'inset-inline-start-4',
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
