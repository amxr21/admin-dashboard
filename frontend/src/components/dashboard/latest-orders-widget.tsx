'use client';

import { useFormatter, useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { WidgetSection } from '@/components/dashboard/widget-section';
import { StatusBadge } from '@/components/status-badge';
import { useCurrencyFormat } from '@/hooks/useCurrencyFormat';
import type { OrderListRow } from '@/lib/orders-api';

/**
 * The last few orders to come in, newest first.
 *
 * ─── NOT THE SAME QUESTION AS "STATUS BREAKDOWN" ─────────────────────
 * That widget counts the window by status; this one names individual orders
 * so an owner can click straight through to the one that just arrived. The
 * counts answer "how is the period going", these rows answer "what just
 * happened" — which is why both earn a place rather than one replacing the
 * other.
 *
 * Each row links to the order's own page: a list that names something and
 * cannot open it just relocates the search.
 */
interface LatestOrdersWidgetProps {
  orders: OrderListRow[] | null;
  isLoading?: boolean;
}

export function LatestOrdersWidget({ orders, isLoading = false }: LatestOrdersWidgetProps) {
  const t = useTranslations('dashboard.latestOrders');
  const formatter = useFormatter();
  // The STORE's currency, not the hardcoded AED in `i18n/formats.ts` — see
  // the hook's own note for why that override has to happen client-side.
  const formatCurrency = useCurrencyFormat();

  return (
    <WidgetSection
      title={t('title')}
      icon="orders"
      tone="accent"
      live
      action={{ href: '/admin/orders', label: t('viewAll') }}
    >

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
        </div>
      ) : orders && orders.length > 0 ? (
        <ul className="space-y-3">
          {orders.map((order) => (
            <li key={order.id} className="text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <Link
                  href={`/admin/orders/${order.id}`}
                  className="min-w-0 truncate font-medium hover:underline"
                >
                  {order.orderNumber}
                </Link>
                <span className="shrink-0 tabular-nums">
                  {/* `total` is null on an order whose lines were all removed;
                      showing nothing beats showing a confident 0.00. */}
                  {order.total === null ? '—' : formatCurrency(Number(order.total))}
                </span>
              </div>
              <div className="text-muted-foreground mt-1 flex items-center gap-2 text-xs">
                {/* The shared badge rather than a hand-rolled translation: it
                    owns both the tone map and the `orderStatus` namespace, and
                    degrades to the raw value on an enum it does not know yet. */}
                <StatusBadge kind="orderStatus" value={order.status} />
                <span className="min-w-0 truncate">
                  {order.customer ? `${order.customer.name ?? order.customer.email} · ` : ''}
                  {formatter.relativeTime(new Date(order.placedAt))}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">{t('empty')}</p>
      )}
    </WidgetSection>
  );
}
