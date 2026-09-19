'use client';

import { useFormatter, useTranslations } from 'next-intl';

import { Skeleton } from '@/components/ui/skeleton';
import { WidgetSection } from '@/components/dashboard/widget-section';
import type { TopProducts } from '@/lib/reports-api';

/**
 * A 5-row glance at the same window's best sellers. The full breakdown (all
 * products, CSV export, a chosen range) lives on Reports — this widget only
 * has to justify itself as "worth a look from the home page."
 *
 * ─── THE BARS ARE THE POINT, NOT THE NUMBERS ─────────────────────────
 * This used to be a bare ranked list: five right-aligned figures a reader had
 * to compare arithmetically to learn that the top seller was twice the fifth.
 * A bar answers that before the numbers are read, which is the entire reason
 * to put a ranking on a dashboard rather than in a table.
 *
 * Measured against the TOP SELLER, not against total revenue — these compare
 * products to each other, and against a total every bar would be a stub.
 *
 * ─── ONE HUE, BECAUSE THIS IS MAGNITUDE AND NOT IDENTITY ─────────────
 * Five products across one measure (revenue). Giving each its own colour
 * would imply the colours mean something and would repaint every row the
 * moment the ranking changed. The fill is always a real series colour — never
 * a neutral grey, which disappears against the track in dark mode.
 */

interface TopProductsWidgetProps {
  data: TopProducts | null;
  isLoading?: boolean;
}

export function TopProductsWidget({ data, isLoading = false }: TopProductsWidgetProps) {
  const t = useTranslations('reports');
  const tDashboard = useTranslations('dashboard.topProducts');
  const formatter = useFormatter();

  const products = data?.products.slice(0, 5) ?? [];
  // Guarded so an all-zero window cannot divide by zero.
  const busiest = Math.max(1, ...products.map((product) => Number(product.revenue)));

  return (
    <WidgetSection
      title={t('topProducts')}
      icon="products"
      tone="accent"
      footNote={
        data && data.products.length > 0
          ? tDashboard('showing', { shown: products.length })
          : null
      }
      action={{ href: '/admin/r/products', label: tDashboard('allProducts') }}
    >
      {isLoading ? (
        <div className="space-y-3.5">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-9 w-full" />
          ))}
        </div>
      ) : products.length > 0 ? (
        <ol className="flex flex-col gap-3.5">
          {products.map((product, index) => (
            <li
              key={product.productId ?? `deleted-${String(index)}`}
              className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-1"
            >
              <span className="min-w-0 truncate text-sm">
                {/* Null when the product was hard-deleted — line items keep a
                    price snapshot but no name. */}
                {product.name ?? (
                  <em className="text-muted-foreground">{t('deletedProduct')}</em>
                )}
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums">
                {formatter.number(Number(product.revenue), 'currency')}
              </span>
              <span className="bg-muted col-span-2 h-2.5 overflow-hidden rounded-full" aria-hidden>
                <span
                  className="bg-primary block h-full rounded-full"
                  style={{
                    // A floor of 2% so the smallest seller still reads as a
                    // bar rather than as an empty track.
                    width: `${String(Math.max(2, (Number(product.revenue) / busiest) * 100))}%`,
                  }}
                />
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-muted-foreground text-sm">{t('noSales')}</p>
      )}
    </WidgetSection>
  );
}
