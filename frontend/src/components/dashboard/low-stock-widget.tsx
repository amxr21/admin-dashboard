'use client';

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { WidgetSection } from '@/components/dashboard/widget-section';
import { cn } from '@/lib/utils';
import type { LowStockSnapshot } from '@/lib/reports-api';

/**
 * What is about to run out — the products, not just the count.
 *
 * ─── WHY THE LIST AND NOT ONLY THE TILE ──────────────────────────────
 * The KPI strip already says "11 low". That number is actionable only if the
 * next click tells you WHICH eleven, and by then you have left the dashboard.
 * The five closest to zero, with their SKUs, answer the reorder question on
 * the page itself.
 *
 * ─── "NEVER RECEIVED" IS A REAL ANSWER ───────────────────────────────
 * `daysSinceLastRestock` is null when no RECEIVED movement was ever recorded
 * against the product. The backend is deliberate about that — it refuses to
 * substitute the product's creation date — so the UI says "never received"
 * rather than rendering a plausible-looking zero.
 *
 * ─── THE BAR IS STOCK AGAINST THE THRESHOLD ──────────────────────────
 * Not against the biggest stock in the list, which would make the worst item
 * look full whenever every item is bad. The threshold is the line the
 * business itself drew, so it is the only denominator that means anything
 * here — and a product at or below zero draws an empty track, which reads as
 * the emergency it is.
 */

interface LowStockWidgetProps {
  data: LowStockSnapshot | null;
  isLoading?: boolean;
}

export function LowStockWidget({ data, isLoading = false }: LowStockWidgetProps) {
  const t = useTranslations('dashboard.lowStock');
  const tStatus = useTranslations('states');

  const products = data?.products ?? [];
  const shown = products.slice(0, 5);

  return (
    <WidgetSection
      title={t('title')}
      icon="inventory"
      tone={products.length > 0 ? 'alert' : 'neutral'}
      live
      footNote={
        data
          ? t('atOrBelow', { count: products.length, threshold: data.threshold })
          : null
      }
      action={{ href: '/admin/inventory?lowStock=true', label: t('reorder') }}
    >
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-9 w-full" />
          ))}
        </div>
      ) : shown.length > 0 ? (
        <ul className="flex flex-col">
          {shown.map((product) => {
            const out = product.stock <= 0;
            // Guarded: a threshold of 0 would divide by zero, and the bar is
            // meaningless in that configuration anyway.
            const fill =
              data && data.threshold > 0
                ? Math.max(0, Math.min(100, (product.stock / data.threshold) * 100))
                : 0;

            return (
              <li
                key={product.productId}
                className="flex items-center justify-between gap-3 border-b py-2.5 last:border-b-0 last:pb-0"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span
                    className="bg-muted h-2 w-12 shrink-0 overflow-hidden rounded-full"
                    aria-hidden
                  >
                    <span
                      className={cn(
                        'block h-full rounded-full',
                        out ? 'bg-destructive' : 'bg-amber-500',
                      )}
                      style={{ width: `${String(fill)}%` }}
                    />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <Link
                      href={`/admin/r/products?q=${encodeURIComponent(product.name)}`}
                      className="truncate text-sm hover:underline"
                    >
                      {product.name}
                    </Link>
                    <span className="text-muted-foreground truncate text-xs">
                      {product.sku ? <span className="force-ltr">{product.sku}</span> : t('noSku')}
                      {' · '}
                      {product.daysSinceLastRestock === null
                        ? t('neverReceived')
                        : t('lastReceived', { days: product.daysSinceLastRestock })}
                    </span>
                  </span>
                </span>

                <span
                  className={cn(
                    'shrink-0 text-sm font-semibold tabular-nums',
                    out ? 'text-destructive' : 'text-amber-700 dark:text-amber-400',
                  )}
                >
                  {/* The word carries the severity alongside the colour — a
                      bare red "0" relies on hue alone. */}
                  {out ? t('outOfStock') : product.stock}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">
          {data ? t('allStocked') : tStatus('empty.title')}
        </p>
      )}
    </WidgetSection>
  );
}
