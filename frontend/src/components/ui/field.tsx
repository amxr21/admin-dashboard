'use client';

import { useTranslations } from 'next-intl';
import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * One labelled control: label, the control itself, and exactly one message
 * underneath it.
 *
 * ─── THIS SHAPE ALREADY EXISTS, SIX TIMES ────────────────────────────
 * `<div className="space-y-2"><Label htmlFor=…>…</Label>{control}</div>` is
 * written out by hand in resource-form, settings-form, staff-sheet,
 * invite-staff-sheet, branch-sheet, business-form, courier-sheet and
 * supplier-sheet — which had gone as far as declaring its own private `Field`
 * at the bottom of the file. This is that component, made shared, with the
 * two halves those copies kept re-deciding: where the error goes, and what
 * happens to the hint while an error is showing.
 *
 * ─── ONE MESSAGE SLOT, NOT TWO ───────────────────────────────────────
 * The error REPLACES the description rather than stacking beneath it, in the
 * visible slot and in `aria-describedby` alike. Both describe the same
 * control, and when a field is wrong, what is wrong with it is the more
 * urgent of the two. `settings-form.tsx` had already settled that precedence;
 * this carries it everywhere rather than leaving each form to rediscover it.
 *
 * ─── THE REQUIRED MARKER SAYS SOMETHING NOW ──────────────────────────
 * Four files render `<span className="text-destructive ms-1" aria-hidden>*</span>`,
 * which shows a sighted user an asterisk and tells a screen-reader user
 * nothing at all. The asterisk stays (it is the convention people scan for)
 * and carries real text beside it, hidden visually.
 *
 * ─── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────
 * It does not own validation, and it does not own the control. Callers keep
 * passing `aria-invalid`/`aria-describedby` to their own input — this renders
 * the message and the ids, it does not wire them, because a Select, a
 * radiogroup and a file input each attach them differently.
 *
 * `label` is optional: `product-gallery-panel` mounts an upload control with
 * no label at all, and forcing one there would invent a heading for a button.
 *
 * ─── WARNINGS ARE A THIRD THING, NOT A SECOND HINT ───────────────────
 * `resource-form` carries three advisory messages that are neither an error
 * nor a description: "changing this slug records a redirect", "turning
 * variants off hides the builder", and a caller-supplied note about the
 * stored value. They differ from a hint in WHEN they appear — a hint explains
 * the field always, a warning appears because of what the user just did — so
 * folding them into `description` would make editing a field hide the
 * explanation of what the field is.
 *
 * They stack below the one message slot rather than replacing it, and they
 * are suppressed while an error shows, for the same reason the hint is: a
 * validation failure is the more urgent thing to read.
 *
 * ─── THE CARD VARIANT ────────────────────────────────────────────────
 * `settings-form` renders each setting as a bordered card rather than a bare
 * stack. That is a real, deliberate difference — the settings page is a grid
 * of independent choices, where every other form is a sequence of fields in
 * one panel — so it is a variant here rather than a reason for that file to
 * keep its own copy of this component.
 */

interface FieldProps {
  /**
   * The control's own id. `htmlFor` targets it, and the message ids are
   * derived from it so a caller can point `aria-describedby` at them without
   * inventing a second naming scheme.
   */
  id: string;
  /** Omit for a control that labels itself (a checkbox with its own inline
   *  label) or genuinely has no label (an "add an image" button). */
  label?: ReactNode;
  /** Renders the asterisk and its screen-reader text. Purely presentational —
   *  the control's own `required`/validation is the caller's business. */
  required?: boolean;
  /** The message shown when the field is wrong. Wins over `description`. */
  error?: string | undefined;
  /** A standing explanation, shown only while there is no error. */
  description?: ReactNode;
  /**
   * Advisory messages about what the user just did — not about what the field
   * IS. Stacked below the message slot, each with a warning icon, and hidden
   * entirely while an error shows.
   *
   * Falsy entries are dropped, so a caller can pass a conditional list
   * (`[changed && msg, optedOut && other]`) without filtering first — which
   * is exactly the shape the three conditions in `resource-form` produce.
   */
  warnings?: ReactNode[];
  /**
   * Renders the field as a bordered card. For a page that is a GRID of
   * independent choices (settings) rather than a sequence of fields in one
   * panel, which is every other form.
   */
  card?: boolean;
  /** Spans both columns of a two-column form grid. */
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
}

/** `${id}-error` and `${id}-hint` — exported so callers can wire
 *  `aria-describedby` without duplicating the template string. */
export function fieldMessageIds(id: string) {
  return { errorId: `${id}-error`, hintId: `${id}-hint` } as const;
}

export function Field({
  id,
  label,
  required = false,
  error,
  description,
  warnings,
  card = false,
  fullWidth = false,
  className,
  children,
}: FieldProps) {
  const t = useTranslations('common');
  const { errorId, hintId } = fieldMessageIds(id);

  // Filtered here rather than at each call site: the conditions producing
  // these are per-field booleans, and making every caller compact its own
  // array is how one of them ends up rendering a stray `false`.
  const shownWarnings = (warnings ?? []).filter(Boolean);

  return (
    <div
      className={cn(
        'space-y-2',
        card && 'bg-card/50 rounded-lg border p-4',
        fullWidth && 'col-span-full',
        className,
      )}
    >
      {label !== undefined ? (
        // `id` as well as `htmlFor`: a radiogroup or segmented control cannot
        // be the target of `htmlFor`, so it names itself with
        // `aria-labelledby={`${id}-label`}` instead — same trick
        // settings-form.tsx uses for its enum controls.
        <Label id={`${id}-label`} htmlFor={id}>
          {label}
          {required ? (
            <>
              <span className="text-destructive ms-1" aria-hidden="true">
                *
              </span>
              <span className="sr-only">{t('requiredField')}</span>
            </>
          ) : null}
        </Label>
      ) : null}

      {children}

      {error ? (
        <p id={errorId} role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : description ? (
        <p id={hintId} className="text-muted-foreground text-sm">
          {description}
        </p>
      ) : null}

      {/* Suppressed entirely while an error shows — see the doc comment on
          why these are a third category rather than a second hint. */}
      {!error && shownWarnings.length > 0
        ? shownWarnings.map((warning, index) => (
            // Index as key: these are a fixed, ordered set of conditions per
            // field, never reordered and never individually removed.
            <p
              key={index}
              className="text-muted-foreground flex items-start gap-1.5 text-sm"
            >
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {warning}
            </p>
          ))
        : null}
    </div>
  );
}
