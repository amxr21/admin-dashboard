'use client';

import { useTranslations } from 'next-intl';
import { Info } from 'lucide-react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * "What does this number actually mean?" — attached to the metric itself.
 *
 * ─── WHY THIS EXISTS (F4.1) ──────────────────────────────────────────
 * This app computes 34 reports, and the rules behind them are genuinely
 * non-obvious and occasionally counter-intuitive:
 *
 *   - canceled orders are EXCLUDED from revenue but still COUNTED as orders
 *   - returned orders are NOT excluded from revenue (the money moved, and
 *     came back — the return is its own event)
 *   - revenue reads the order-line snapshot, never today's product price
 *   - margin covers only lines with a recorded cost, so it is partial
 *
 * Every one of those was written down — as a comment in `reports.service.ts`,
 * where no one using the dashboard will ever see it. Two numbers that
 * legitimately disagree then look like a bug, and the honest answer ("they
 * measure different things, on purpose") is invisible. That is the whole of
 * the "reports are vague and unclear" complaint.
 *
 * ─── WHY A COMPONENT AND NOT A PROP ──────────────────────────────────
 * This markup already existed, hardcoded inline for exactly ONE tile
 * (`averageOrderValue` in `reports-view.tsx`). Copying it per metric is how
 * six subtly different info buttons end up in one app. It is a component so
 * the affordance, the icon, the focus ring and the accessible name are
 * decided once.
 *
 * ─── IT IS A BUTTON, NOT A BARE ICON ─────────────────────────────────
 * Radix needs a focusable trigger for the tooltip to be reachable by keyboard
 * at all, and a `<span>` is not focusable. `type="button"` matters because
 * some of these sit inside forms, where a bare `<button>` would submit.
 */

interface MetricDefinitionProps {
  /**
   * The explanation itself — already translated by the caller, because the
   * definitions live under each report's own translation namespace rather
   * than in one shared bag of strings. That keeps a report's copy next to
   * the rest of that report's copy.
   */
  definition: string;
  /**
   * Names WHICH metric is being explained, for the accessible name. Without
   * it every one of these announces as an identical "More information",
   * which is useless when a page has six.
   */
  label: string;
}

export function MetricDefinition({ definition, label }: MetricDefinitionProps) {
  const t = useTranslations('reports');

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="text-muted-foreground/70 hover:text-foreground focus-visible:ring-ring rounded-full focus-visible:ring-2 focus-visible:outline-none"
          aria-label={t('definitionLabel', { label })}
        >
          <Info className="size-3.5" aria-hidden />
        </button>
      </TooltipTrigger>
      {/* Deliberately roomier than the default: these are sentences
          explaining an exclusion rule, not one-word hints, and a tooltip that
          wraps to eight narrow lines is harder to read than the comment it
          came from. */}
      <TooltipContent className="max-w-xs">{definition}</TooltipContent>
    </Tooltip>
  );
}
