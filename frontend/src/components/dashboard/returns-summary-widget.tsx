'use client';

import { useFormatter, useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import type { ReturnsSummary } from '@/lib/reports-api';

/**
 * Returns/refunds — deliberately its own widget rather than folded into
 * order status, per the same reasoning as the backend's `getReturnsSummary`:
 * "how much came back and why" is a different question from "how much came
 * in." The per-product ranking is the actual payoff — a spike on one SKU is
 * a sizing/quality signal, not just a number.
 */
interface ReturnsSummaryWidgetProps {
  data: ReturnsSummary | null;
  isLoading?: boolean;
}

export function ReturnsSummaryWidget({ data, isLoading = false }: ReturnsSummaryWidgetProps) {
  const t = useTranslations('dashboard.returns');
  const tStatus = useTranslations('states');
  const formatter = useFormatter();

  return (
    <section className="bg-card rounded-lg border p-4" aria-label={t('title')}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">{t('title')}</h2>
        <Link href="/admin/returns" className="text-muted-foreground text-xs hover:underline">
          {t('viewAll')}
        </Link>
      </div>

      {isLoading ? (
        <div className="mt-3 space-y-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-6 w-full" />
          ))}
        </div>
      ) : data ? (
        <div className="mt-3 space-y-4">
          <dl className="grid grid-cols-3 gap-3">
            <div className="space-y-0.5">
              <dt className="text-muted-foreground text-xs">{t('returnRate')}</dt>
              <dd className="text-sm font-medium tabular-nums">
                {formatter.number(data.returnRate, { style: 'percent', maximumFractionDigits: 1 })}
              </dd>
            </div>
            <div className="space-y-0.5">
              <dt className="text-muted-foreground text-xs">{t('refundValue')}</dt>
              <dd className="text-sm font-medium tabular-nums">
                {formatter.number(Number(data.refundValue), 'currency')}
              </dd>
            </div>
            <div className="space-y-0.5">
              <dt className="text-muted-foreground text-xs">{t('unitsReturned')}</dt>
              <dd className="text-sm font-medium tabular-nums">
                {formatter.number(data.unitsReturned)}
              </dd>
            </div>
          </dl>

          {data.topReturnedProducts.length > 0 ? (
            <ol className="space-y-2 border-t pt-3">
              {data.topReturnedProducts.slice(0, 5).map((product, index) => (
                <li
                  key={product.productId ?? `deleted-${String(index)}`}
                  className="flex items-baseline justify-between gap-3 text-sm"
                >
                  <span className="min-w-0 truncate">
                    <span className="text-muted-foreground me-2 tabular-nums">{index + 1}.</span>
                    {product.name ?? <em className="text-muted-foreground">{t('deletedProduct')}</em>}
                  </span>
                  <span className="text-muted-foreground shrink-0 tabular-nums">
                    {t('units', { count: product.unitsReturned })}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-muted-foreground border-t pt-3 text-sm">{t('none')}</p>
          )}
        </div>
      ) : (
        <p className="text-muted-foreground mt-3 text-sm">{tStatus('empty.title')}</p>
      )}
    </section>
  );
}
