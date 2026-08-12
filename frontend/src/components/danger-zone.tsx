'use client';

import { useCallback, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Shared "danger zone" building blocks — the container, row, and typed-
 * confirm hook `settings/danger-zone-panel.tsx` (B3.4) established for
 * store-wide destructive actions. Extracted here (not into that file, which
 * Track B owns) so a detail page's own danger zone (C5.2 — orders, couriers)
 * gets the identical visual/interaction contract — destructive border,
 * icon + title + description row, confirm button disabled until the exact
 * phrase is typed — without a second hand-rolled copy drifting from it.
 */

export function DangerZoneSection({
  titleId,
  title,
  description,
  children,
}: {
  titleId: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={titleId} className="space-y-4">
      <div className="border-destructive/40 space-y-1 border-t pt-6">
        <div className="flex items-center gap-2">
          <AlertTriangle className="text-destructive size-5" aria-hidden="true" />
          <h2 id={titleId} className="text-destructive text-lg font-semibold tracking-tight">
            {title}
          </h2>
        </div>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>

      <div className="border-destructive/40 divide-destructive/20 divide-y rounded-lg border">
        {children}
      </div>
    </section>
  );
}

export function DangerZoneRow({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="flex items-start gap-3">
        <span className="text-destructive mt-0.5" aria-hidden="true">
          {icon}
        </span>
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
      </div>
      {action}
    </div>
  );
}

/** Types the confirm phrase before the action button enables. */
export function useTypedConfirm(phrase: string) {
  const [typed, setTyped] = useState('');
  const confirmed = typed.trim() === phrase;
  const reset = useCallback(() => setTyped(''), []);
  return { typed, setTyped, confirmed, reset };
}
