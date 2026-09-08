'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppSettings } from '@/components/providers/settings-provider';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { fetchShiftSummary, type Shift, type ShiftSummary } from '@/lib/shifts-api';

/**
 * What happened during one shift (F6.4).
 *
 * ─── IT COUNTS CHANGES, NOT BUSYNESS ─────────────────────────────────
 * The number comes from `AuditLog`, which records WRITES. Reads are not
 * audited, so somebody who spent a shift answering customer questions and
 * looking things up shows a low count while having worked just as hard. The
 * panel says that outright: a bare "12 actions" next to a person's name
 * invites exactly the wrong reading, and this is a screen a manager looks at
 * before a conversation about someone's work.
 *
 * ─── A SHEET, NOT A PAGE ─────────────────────────────────────────────
 * A brief detour from the shift list you came from, a short read, and the
 * list underneath is the context — the drawer pole of the convention.
 */

interface ShiftSummarySheetProps {
  shift: Shift | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShiftSummarySheet({ shift, open, onOpenChange }: ShiftSummarySheetProps) {
  const t = useTranslations('shifts.summary');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();
  const { editPanelMode } = useAppSettings();

  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shiftId = shift?.id ?? null;

  const load = useCallback(async () => {
    if (!shiftId) return;

    setError(null);
    setSummary(null);

    try {
      setSummary(await fetchShiftSummary(shiftId));
    } catch (caught) {
      setError(translateError(caught));
    }
  }, [shiftId, translateError]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="end"
        variant={editPanelMode}
        className="max-w-lg overflow-y-auto"
        title={t('title')}
      >
        <div className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold">{t('title')}</h2>
            {shift ? (
              <p className="text-muted-foreground mt-1 text-sm">
                {t('subtitle', {
                  name: shift.user.name ?? shift.user.email,
                  branch: shift.branch.name,
                })}
              </p>
            ) : null}
          </div>

          {error ? (
            <p
              role="alert"
              className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
            >
              {error}
            </p>
          ) : null}

          {summary === null && error === null ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : null}

          {summary ? (
            <>
              <div className="rounded-lg border p-4">
                <p className="text-2xl font-semibold tabular-nums">
                  {formatter.number(summary.totalActions)}
                </p>
                <p className="text-muted-foreground text-sm">{t('changesLabel')}</p>
                {/* Stated, not implied: a low count is not a lazy shift. */}
                <p className="text-muted-foreground mt-2 text-xs">{t('changesCaveat')}</p>
              </div>

              {summary.byAction.length > 0 ? (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium">{t('breakdown')}</h3>
                  <ul className="divide-y rounded-lg border">
                    {summary.byAction.map((row) => (
                      <li
                        key={row.action}
                        className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
                      >
                        <span className="truncate font-mono text-xs">{row.action}</span>
                        <span className="tabular-nums">{formatter.number(row.count)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">
                  {t('empty')}
                </p>
              )}

              {summary.recent.length > 0 ? (
                <div className="space-y-2">
                  <h3 className="text-sm font-medium">{t('recent')}</h3>
                  <ul className="divide-y rounded-lg border">
                    {summary.recent.map((entry) => (
                      <li key={entry.id} className="px-4 py-2 text-sm">
                        <p className="truncate font-mono text-xs">{entry.action}</p>
                        <time
                          className="text-muted-foreground text-xs"
                          dateTime={entry.createdAt}
                        >
                          {formatter.dateTime(new Date(entry.createdAt), 'short')}
                        </time>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
