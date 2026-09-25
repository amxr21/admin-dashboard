'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { LoadingState } from '@/components/ui/loading-state';
import { useCurrencyFormat } from '@/hooks/useCurrencyFormat';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { fetchPosVariants, type BrowsedProduct, type PosVariant } from '@/lib/pos-api';

interface VariantPickerDialogProps {
  /** The tapped product; null closes the dialog. */
  product: BrowsedProduct | null;
  onPick: (product: BrowsedProduct, variant: PosVariant) => void;
  onClose: () => void;
}

/**
 * Choose which size or colour to sell, for a product whose stock lives on its
 * variants. Each option shows its own price and stock at this branch; a
 * sold-out option is shown disabled, never hidden, the same rule as a grid tile.
 */
export function VariantPickerDialog({ product, onPick, onClose }: VariantPickerDialogProps) {
  const t = useTranslations('pos.variants');
  const translateError = useTranslatedApiError();
  const formatCurrency = useCurrencyFormat();
  const [variants, setVariants] = useState<PosVariant[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!product) return;

    let cancelled = false;
    setVariants(null);
    setError(null);

    fetchPosVariants(product.id)
      .then((rows) => {
        if (!cancelled) setVariants(rows);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(translateError(caught));
      });

    return () => {
      cancelled = true;
    };
  }, [product, translateError]);

  return (
    <Dialog open={product !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogTitle>{t('title', { name: product?.name ?? '' })}</DialogTitle>
        <DialogDescription>{t('description')}</DialogDescription>

        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : variants === null ? (
          <LoadingState />
        ) : variants.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('empty')}</p>
        ) : (
          <ul className="grid gap-2">
            {variants.map((variant) => {
              const soldOut = variant.branchStock !== null && variant.branchStock <= 0;

              return (
                <li key={variant.id}>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-auto min-h-11 w-full justify-between gap-3 py-2 text-start"
                    disabled={soldOut}
                    onClick={() => product && onPick(product, variant)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{variant.name}</span>
                      <span className="text-muted-foreground force-ltr block truncate text-xs">
                        {variant.sku}
                      </span>
                    </span>
                    <span className="shrink-0 text-end">
                      <span className="block tabular-nums">{formatCurrency(Number(variant.price))}</span>
                      <span className="text-muted-foreground block text-xs">
                        {soldOut
                          ? t('soldOut')
                          : variant.branchStock === null
                            ? null
                            : t('inStock', { count: variant.branchStock })}
                      </span>
                    </span>
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}