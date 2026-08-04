'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppSettings } from '@/components/providers/settings-provider';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { fetchMovements, type MovementListResult } from '@/lib/inventory-api';

/**
 * Why this product's stock is what it is.
 *
 * Newest first, because the recent change is what someone is checking. Each
 * entry shows the signed delta, the reason and the note — the three things
 * that turn "47" from a number into an explanation.
 */

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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !productId) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    fetchMovements(productId, { pageSize: 50 })
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
  }, [open, productId, translateError]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="end"
        variant={editPanelMode}
        className="w-full max-w-md overflow-y-auto"
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
                    <time
                      className="text-muted-foreground text-xs"
                      dateTime={movement.createdAt}
                    >
                      {formatter.dateTime(new Date(movement.createdAt), 'long')}
                    </time>
                  </div>
                </li>
              ))}
            </ol>
          ) : null}

          {result && result.total > result.movements.length ? (
            <p className="text-muted-foreground text-sm">
              {t('truncated', {
                shown: formatter.number(result.movements.length),
                total: formatter.number(result.total),
              })}
            </p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
