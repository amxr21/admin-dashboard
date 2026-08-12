'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { CheckCircle2, ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppSettings } from '@/components/providers/settings-provider';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import {
  fetchMovements,
  fetchReconcile,
  type MovementListResult,
  type ReconcileResult,
} from '@/lib/inventory-api';

/**
 * Why this product's stock is what it is.
 *
 * Newest first, because the recent change is what someone is checking. Each
 * entry shows the signed delta, the reason, the note, and WHO (B4.3) — the
 * four things that turn "47" from a number into an explanation.
 *
 * ─── RECONCILE (B4.2) ──────────────────────────────────────────────────
 * `GET /inventory/:productId/reconcile` existed with zero frontend
 * references — built specifically so a stock/log mismatch is diagnosable
 * from here rather than by someone querying the database directly. Fetched
 * once per open, not polled: this is a rarely-true discrepancy, not a
 * live-changing value.
 */

const PAGE_SIZE = 20;

interface MovementLogSheetProps {
  productId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MovementLogSheet({
  productId,
  open,
  onOpenChange,
}: MovementLogSheetProps) {
  const t = useTranslations('inventory.log');
  const tReason = useTranslations('stockReason');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();
  const { editPanelMode } = useAppSettings();

  const [result, setResult] = useState<MovementListResult | null>(null);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [reconcile, setReconcile] = useState<ReconcileResult | null>(null);

  // Reset to page 1 whenever the sheet opens for a (possibly different)
  // product — otherwise reopening on another product could silently request
  // a page past the end of its own, shorter history.
  useEffect(() => {
    if (open) setPage(1);
  }, [open, productId]);

  useEffect(() => {
    if (!open || !productId) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    fetchMovements(productId, { page, pageSize: PAGE_SIZE })
      .then((loaded) => {
        if (!cancelled) setResult(loaded);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(translateError(caught));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, productId, page, translateError]);

  // Fetched once per open — a rarely-true discrepancy, not a value worth
  // polling — and deliberately best-effort: a failed reconcile check must
  // not block the log itself from showing.
  useEffect(() => {
    if (!open || !productId) {
      setReconcile(null);
      return;
    }

    let cancelled = false;
    fetchReconcile(productId)
      .then((loaded) => {
        if (!cancelled) setReconcile(loaded);
      })
      .catch(() => {
        if (!cancelled) setReconcile(null);
      });

    return () => {
      cancelled = true;
    };
  }, [open, productId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="end"
        variant={editPanelMode}
        className="max-w-md overflow-y-auto"
        title={t('title')}
      >
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">{t('title')}</h2>
            {result ? (
              <p className="text-muted-foreground mt-1 text-sm">
                {result.product.name} ·{' '}
                {t('current', { stock: formatter.number(result.product.stock) })}
              </p>
            ) : null}
          </div>

          {reconcile && !reconcile.agrees ? (
            <div className="border-destructive/40 bg-destructive/10 flex items-start gap-2 rounded-md border p-3 text-sm">
              <TriangleAlert className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>
                {t('reconcileMismatch', {
                  stock: formatter.number(reconcile.stock),
                  fromMovements: formatter.number(reconcile.fromMovements),
                })}
              </p>
            </div>
          ) : reconcile && reconcile.agrees ? (
            <div className="text-muted-foreground flex items-center gap-2 text-xs">
              <CheckCircle2 className="text-success size-3.5 shrink-0" aria-hidden="true" />
              {t('reconcileAgrees')}
            </div>
          ) : null}

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : null}

          {error ? (
            <div className="space-y-2">
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                {t('close')}
              </Button>
            </div>
          ) : null}

          {!isLoading && !error && result?.movements.length === 0 ? (
            // Distinct from an error: this product genuinely has no history.
            <p className="text-muted-foreground text-sm">{t('empty')}</p>
          ) : null}

          {!isLoading && !error && result && result.movements.length > 0 ? (
            <ol className="space-y-3">
              {result.movements.map((movement) => (
                <li key={movement.id} className="flex items-start gap-3 border-b pb-3">
                  <span
                    className={
                      movement.delta > 0
                        ? 'text-success font-medium tabular-nums'
                        : 'text-destructive font-medium tabular-nums'
                    }
                  >
                    {/* Explicit sign: "+50" and "−3" read as movements, where a
                        bare 50 and 3 read as quantities. */}
                    {movement.delta > 0 ? '+' : '−'}
                    {formatter.number(Math.abs(movement.delta))}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{tReason(movement.reason)}</p>
                    {movement.note ? (
                      <p className="text-muted-foreground text-sm">{movement.note}</p>
                    ) : null}
                    <p className="text-muted-foreground text-xs">
                      <time dateTime={movement.createdAt}>
                        {formatter.dateTime(new Date(movement.createdAt), 'long')}
                      </time>
                      {movement.actorName ? (
                        <span> · {t('by', { name: movement.actorName })}</span>
                      ) : null}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          ) : null}

          {result && result.totalPages > 1 ? (
            <div className="flex items-center justify-between gap-2 border-t pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isLoading || page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                <ChevronLeft aria-hidden="true" />
                {t('previousPage')}
              </Button>
              <p className="text-muted-foreground text-xs">
                {t('pageOf', { page: result.page, totalPages: result.totalPages })}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isLoading || page >= result.totalPages}
                onClick={() => setPage((current) => Math.min(result.totalPages, current + 1))}
              >
                {t('nextPage')}
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
