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
  fetchVariantMovements,
  fetchVariantReconcile,
  type VariantMovementListResult,
  type VariantReconcileResult,
} from '@/lib/variants-api';

/**
 * Why a variant's stock is what it is — same shape as
 * `inventory/movement-log-sheet.tsx` for the top-level product, re-scoped to
 * `variantId`. A2's own `movement-log-sheet.tsx` is the pattern this mirrors
 * deliberately rather than reinventing: newest first, signed delta, reason,
 * note, WHO, paginated, plus a once-per-open reconcile check.
 *
 * A separate component rather than a mode flag threaded through the
 * product-level sheet — the two fetch from entirely different endpoints
 * (`/inventory/:productId/...` vs `/variants/:id/...`) with different
 * response shapes (`product` vs `variant`), so branching one component on
 * "which kind of thing am I logging" would mean an `if` at every fetch call
 * for no shared logic saved.
 */

const PAGE_SIZE = 20;

interface VariantMovementLogSheetProps {
  variantId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VariantMovementLogSheet({
  variantId,
  open,
  onOpenChange,
}: VariantMovementLogSheetProps) {
  const t = useTranslations('productVariants.log');
  const tReason = useTranslations('stockReason');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();
  const { editPanelMode } = useAppSettings();

  const [result, setResult] = useState<VariantMovementListResult | null>(null);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [reconcile, setReconcile] = useState<VariantReconcileResult | null>(null);

  // Reset to page 1 whenever the sheet opens for a (possibly different)
  // variant — otherwise reopening on another variant could silently request
  // a page past the end of its own, shorter history.
  useEffect(() => {
    if (open) setPage(1);
  }, [open, variantId]);

  useEffect(() => {
    if (!open || !variantId) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    fetchVariantMovements(variantId, { page, pageSize: PAGE_SIZE })
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
  }, [open, variantId, page, translateError]);

  // Fetched once per open — a rarely-true discrepancy, not a value worth
  // polling — and deliberately best-effort: a failed reconcile check must
  // not block the log itself from showing.
  useEffect(() => {
    if (!open || !variantId) {
      setReconcile(null);
      return;
    }

    let cancelled = false;
    fetchVariantReconcile(variantId)
      .then((loaded) => {
        if (!cancelled) setReconcile(loaded);
      })
      .catch(() => {
        if (!cancelled) setReconcile(null);
      });

    return () => {
      cancelled = true;
    };
  }, [open, variantId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="end"
        variant={editPanelMode}
        className="w-full max-w-md overflow-y-auto"
        title={result ? t('title', { name: result.variant.name }) : t('title', { name: '' })}
      >
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">
              {result ? t('title', { name: result.variant.name }) : t('title', { name: '' })}
            </h2>
            {result ? (
              <p className="text-muted-foreground mt-1 text-sm">
                {t('current', { stock: formatter.number(result.variant.stock) })}
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
            // Distinct from an error: this variant genuinely has no history.
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
