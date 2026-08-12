'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Save/discard bar for any form with a dirty state.
 *
 * NOTE: `resource-form.tsx` is currently the ONLY consumer. This comment used
 * to also name `settings-form.tsx`, which does not import this component (it
 * renders its own footer) — corrected 2026-08-12 rather than left to mislead
 * the next reader into thinking a change here is riskier than it is.
 *
 * ─── "STICKY" MEANS VISIBLE BEFORE SAVE, NOT AFTER ───────────────────────
 * The standing 2026-08-03 note this exists to satisfy: a field change must
 * surface a dirty-state signal BEFORE Save is clicked, not only in a
 * post-save toast. A footer that scrolls away with the rest of a long form
 * fails that the moment the field someone just edited is above the fold and
 * the bar isn't — so this is `sticky bottom-0`, not a plain trailing `<div>`.
 * It only pins WHILE the surrounding container can scroll past it; on a
 * short form that never scrolls, `sticky` is a no-op and it just sits at the
 * bottom like the plain footer it replaces.
 *
 * ─── WHY IT'S THE CALLER'S JOB TO COMPUTE `isDirty` ───────────────────────
 * "Unsaved changes" means something different per form — a resource form
 * diffs against the row it opened with, the settings form diffs against the
 * last-fetched registry. Neither belongs here; this component only renders
 * whatever the caller already decided.
 */

interface StickyFormBarProps {
  isDirty: boolean;
  isSaving: boolean;
  /** Shown next to the dirty label — lets a caller say "3 unsaved changes"
   *  instead of just "unsaved changes", when it knows the count. */
  unsavedCount?: number;
  /** `'submit'` for a form whose Save button submits an enclosing `<form>`
   *  (resource-form.tsx); a plain `onClick` handler otherwise
   *  (settings-form.tsx, which has no surrounding `<form>` element). Passing
   *  both would make the double-fire ambiguous, so this is exclusive rather
   *  than "pass whichever you have". */
  save: { type: 'submit' } | { type: 'button'; onClick: () => void };
  onCancel?: () => void;
  saveLabel?: string;
  cancelLabel?: string;
  savingLabel?: string;
  /** Shown briefly after a save completes, while NOT dirty — a resource form
   *  closes on save and never needs this; settings-form.tsx, which stays
   *  open, does. */
  justSaved?: boolean;
  /**
   * How the bar holds its place at the bottom.
   *
   * `'sticky'` (default) is for a form that scrolls as ONE block — the bar
   * pins against the scrolling ancestor as content passes under it. This is
   * settings-form.tsx, a page section.
   *
   * `'static'` is for a form that is itself a flex column with its OWN inner
   * scroll region (resource-form.tsx inside a Sheet). There the bar is a
   * non-scrolling flex sibling BELOW the scroller, so it is already always
   * visible — and `sticky` is actively wrong: with no scrollable ancestor of
   * its own to pin against it falls back to normal flow and renders wherever
   * it happens to land, which is mid-form.
   */
  pin?: 'sticky' | 'static';
  className?: string;
}

export function StickyFormBar({
  isDirty,
  isSaving,
  unsavedCount,
  save,
  onCancel,
  saveLabel,
  cancelLabel,
  savingLabel,
  justSaved = false,
  pin = 'sticky',
  className,
}: StickyFormBarProps) {
  const t = useTranslations('common');

  return (
    <div
      className={cn(
        // `bg-card` (not transparent) so content scrolling underneath
        // doesn't show through the bar once it starts pinning.
        'bg-card flex items-center gap-3 border-t pt-4 pb-1',
        // `shrink-0` in the static case: as a flex child it would otherwise
        // be compressed by a tall scroll region above it.
        pin === 'sticky' ? 'sticky bottom-0' : 'shrink-0',
        className,
      )}
    >
      {onCancel ? (
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSaving}>
          {cancelLabel ?? t('cancel')}
        </Button>
      ) : null}

      <Button
        type={save.type}
        onClick={save.type === 'button' ? save.onClick : undefined}
        disabled={isSaving || !isDirty}
      >
        {isSaving ? (savingLabel ?? t('saving')) : (saveLabel ?? t('save'))}
      </Button>

      {isDirty ? (
        <p role="status" className="text-muted-foreground text-sm">
          {unsavedCount !== undefined
            ? t('unsavedChanges', { count: unsavedCount })
            : t('unsavedChangesPlain')}
        </p>
      ) : justSaved ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t('savedNotice')}
        </p>
      ) : null}
    </div>
  );
}
