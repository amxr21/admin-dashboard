'use client';

import { useTranslations } from 'next-intl';

import { Skeleton } from '@/components/ui/skeleton';
import { useCurrencyFormat } from '@/hooks/useCurrencyFormat';
import type { TopProducts } from '@/lib/reports-api';

/**
 * A 5-row glance at the same window's best sellers. The full breakdown (all
 * products, CSV export, a chosen range) lives on Reports — this widget only
 * has to justify itself as "worth a look from the home page."
 */

interface TopProductsWidgetProps {
  data: TopProducts | null;
  isLoading?: boolean;
}

export function TopProductsWidget({ data, isLoading = false }: TopProductsWidgetProps) {
  const t = useTranslations('reports');
  const formatCurrency = useCurrencyFormat();

  return (
    <section className="bg-card rounded-lg border p-4" aria-label={t('topProducts')}>
      <h2 className="text-sm font-medium">{t('topProducts')}</h2>

      {isLoading ? (
        <div className="mt-3 space-y-2">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-6 w-full" />
          ))}
        </div>
      ) : data && data.products.length > 0 ? (
        <ol className="mt-3 space-y-2">
          {data.products.slice(0, 5).map((product, index) => (
            <li
              key={product.productId ?? `deleted-${String(index)}`}
              className="flex items-baseline justify-between gap-3 border-b pb-2 text-sm last:border-b-0 last:pb-0"
            >
              <span className="min-w-0 truncate">
                <span className="text-muted-foreground me-2 tabular-nums">{index + 1}.</span>
                {/* Null when the product was hard-deleted — line items keep a
                    price snapshot but no name. */}
                {product.name ?? (
                  <em className="text-muted-foreground">{t('deletedProduct')}</em>
                )}
              </span>
              <span className="shrink-0 font-medium tabular-nums">
                {formatCurrency(Number(product.revenue))}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-muted-foreground mt-3 text-sm">{t('noSales')}</p>
      )}
    </section>
  );
}
