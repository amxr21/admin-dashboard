'use client';

import { useId, useState, type ComponentProps } from 'react';
import { useTranslations } from 'next-intl';
import { Eye, EyeOff } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * A password field you can un-hide while typing.
 *
 * ─── WHY THIS IS NOT "SHOW ME MY PASSWORD" ───────────────────────────
 * Stored passwords are bcrypt hashes and are mathematically unrecoverable —
 * nothing in this app can display an existing one. This reveals only what is
 * being typed RIGHT NOW, in this box, which is the actual need: catching a
 * typo before submitting, on a keyboard whose layout may not match the label.
 *
 * ─── THE RTL TRAP THIS AVOIDS ────────────────────────────────────────
 * globals.css forces `direction: ltr; unicode-bidi: isolate` by ATTRIBUTE
 * SELECTOR — `input[type='password']`, alongside tel/email/url. Toggling the
 * type to "text" stops that selector matching, so on an Arabic page the
 * characters would visually jump to RTL mid-typing: the same string, suddenly
 * reordered, which reads as corruption rather than as a reveal.
 *
 * `.force-ltr` is the same rule under a class instead of an attribute, so it
 * holds in BOTH states. Applied unconditionally rather than only when
 * revealed — a class that appears and disappears is one refactor away from
 * being dropped as redundant.
 *
 * ─── STARTS HIDDEN, ALWAYS ───────────────────────────────────────────
 * Not remembered across mounts. Reveal is a deliberate act for one moment at
 * one keyboard; persisting it would leave a password on screen for whoever
 * opens the page next, which is the shoulder-surfing problem the masking
 * exists to solve.
 */
type PasswordInputProps = Omit<ComponentProps<typeof Input>, 'type'>;

export function PasswordInput({ className, id, ...props }: PasswordInputProps) {
  const t = useTranslations('common.password');
  const [revealed, setRevealed] = useState(false);
  // `useId` so the toggle can be labelled against this specific field even
  // when several password inputs sit on one form (change-password has two).
  const fallbackId = useId();
  const inputId = id ?? fallbackId;

  return (
    <div className="relative">
      <Input
        {...props}
        id={inputId}
        type={revealed ? 'text' : 'password'}
        // `pe-9` reserves room for the toggle at the reading END — logical, so
        // it lands on the correct side in Arabic without a second rule.
        className={cn('force-ltr pe-9', className)}
      />

      <button
        type="button"
        // Not a <Button>: this sits INSIDE the input's box, and Button's own
        // height/padding would fight the absolute positioning. A bare button
        // with an explicit focus ring is the smaller, more honest element.
        onClick={() => setRevealed((current) => !current)}
        // `end-1` rather than `right-1` — mirrors in RTL automatically.
        className={cn(
          'absolute end-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm',
          'text-muted-foreground hover:text-foreground',
          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
          'disabled:pointer-events-none disabled:opacity-50',
        )}
        // Inherits the field's own disabled state: a reveal toggle on a
        // disabled field would be a live control on dead input.
        disabled={props.disabled}
        // The label says what the click DOES, not what the state is — "Show
        // password" while hidden. `aria-pressed` carries the state, so a
        // screen reader is not told "hide" on a field that is still masked.
        aria-label={revealed ? t('hide') : t('show')}
        aria-pressed={revealed}
        aria-controls={inputId}
        // Never submits, and never lands in the tab order between the field
        // and the submit button by accident — it is reachable, just after.
        tabIndex={0}
      >
        {revealed ? (
          <EyeOff className="size-4" aria-hidden="true" />
        ) : (
          <Eye className="size-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
