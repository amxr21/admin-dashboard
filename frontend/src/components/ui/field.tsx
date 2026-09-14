'use client';

import { useTranslations } from 'next-intl';
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
  fullWidth = false,
  className,
  children,
}: FieldProps) {
  const t = useTranslations('common');
  const { errorId, hintId } = fieldMessageIds(id);

  return (
    <div className={cn('space-y-2', fullWidth && 'col-span-full', className)}>
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
    </div>
  );
}
