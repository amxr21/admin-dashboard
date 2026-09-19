'use client';

import { useFormatter, useTranslations } from 'next-intl';

import { MetricDefinition } from '@/components/reports/metric-definition';
import { Skeleton } from '@/components/ui/skeleton';
import { WidgetSection } from '@/components/dashboard/widget-section';
import type { ReturnsSummary } from '@/lib/reports-api';

/**
 * Returns/refunds — deliberately its own widget rather than folded into
 * order status, per the same reasoning as the backend's `getReturnsSummary`:
 * "how much came back and why" is a different question from "how much came
 * in." The per-product ranking is the actual payoff — a spike on one SKU is
 * a sizing/quality signal, not just a number.
 *
 * ─── THREE HEADLINE FIGURES, THEN THE RANKING ────────────────────────
 * Rate, refunded value and units answer "how bad"; the ranking answers
 * "where". Previously all four were the same size in one flat list, so the
 * summary and the detail competed. The figures now lead.
 *
 * ─── THE RANKING BARS USE A SECOND SERIES HUE ────────────────────────
 * Orange, not the primary blue the top-sellers widget uses. The two panels
 * sit side by side showing product rankings that mean opposite things — best
 * sellers and worst returns — and one hue across both would invite reading
 * them as the same measure.
 */

interface ReturnsSummaryWidgetProps {
  data: ReturnsSummary | null;
  isLoading?: boolean;
}

export function ReturnsSummaryWidget({ data, isLoading = false }: ReturnsSummaryWidgetProps) {
  const t = useTranslations('dashboard.returns');
  const tStatus = useTranslations('states');
  const formatter = useFormatter();

  const ranked = data?.topReturnedProducts.slice(0, 4) ?? [];
  const worst = Math.max(1, ...ranked.map((product) => product.unitsReturned));

  const figures = data
    ? [
        {
          key: 'returnRate',
          label: t('returnRate'),
          definition: t('definitions.returnRate'),
          value: formatter.number(data.returnRate, {
            style: 'percent',
            maximumFractionDigits: 1,
          }),
        },
        {
          key: 'refundValue',
          label: t('refundValue'),
          definition: t('definitions.refundValue'),
          value: formatter.number(Number(data.refundValue), 'currency'),
        },
        {
          key: 'unitsReturned',
          label: t('unitsReturned'),
          definition: t('definitions.unitsReturned'),
          value: formatter.number(data.unitsReturned),
        },
      ]
    : [];

  return (
    <WidgetSection
      title={t('title')}
      icon="returns"
      tone="neutral"
      footNote={ranked.length > 0 ? t('mostReturned') : null}
      action={{ href: '/admin/returns', label: t('viewAll') }}
    >
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-12 w-full" />
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
        </div>
      ) : data ? (
        <div className="space-y-4">
          <dl className="grid grid-cols-3 gap-3">
            {figures.map((figure) => (
              <div key={figure.key} className="min-w-0 space-y-0.5">
                <dt className="text-muted-foreground flex items-center gap-1 text-[11px] font-semibold tracking-wide uppercase">
                  <span className="truncate">{figure.label}</span>
                  <MetricDefinition label={figure.label} definition={figure.definition} />
                </dt>
                <dd className="text-xl font-semibold tracking-tight tabular-nums">
                  {figure.value}
                </dd>
              </div>
            ))}
          </dl>

          {ranked.length > 0 ? (
            <ol className="flex flex-col gap-3 border-t pt-3.5">
              {ranked.map((product, index) => (
                <li
                  key={product.productId ?? `deleted-${String(index)}`}
                  className="grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-1"
                >
                  <span className="min-w-0 truncate text-sm">
                    {product.name ?? (
                      <em className="text-muted-foreground">{t('deletedProduct')}</em>
                    )}
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {t('units', { count: product.unitsReturned })}
                  </span>
                  <span
                    className="bg-muted col-span-2 h-2.5 overflow-hidden rounded-full"
                    aria-hidden
                  >
                    <span
                      className="block h-full rounded-full bg-orange-500"
                      style={{
                        width: `${String(Math.max(2, (product.unitsReturned / worst) * 100))}%`,
                      }}
                    />
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-muted-foreground border-t pt-3.5 text-sm">{t('none')}</p>
          )}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">{tStatus('empty.title')}</p>
      )}
    </WidgetSection>
  );
}
