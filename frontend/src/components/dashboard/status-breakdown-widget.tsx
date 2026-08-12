'use client';

import { useFormatter, useTranslations } from 'next-intl';
import {
  Clock,
  PackageCheck,
  RotateCcw,
  ShieldCheck,
  Truck,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/status-badge';
import { useCurrencyFormat } from '@/hooks/useCurrencyFormat';
import type { StatusBreakdown } from '@/lib/reports-api';

/**
 * Order outcomes for the same window — how many landed in each status. The
 * badge is the same enum → colour → label mapping used everywhere else, so a
 * cancelled order reads the same tone here as it does in the orders table.
 *
 * One column PER status (a 3-wide grid, so six statuses fill two rows)
 * rather than a tall single-file list — a narrow list left most of the
 * card's width empty. Each column stacks icon+count above the status label,
 * icon then text, matching a KPI tile's own number-then-label idiom. The
 * icon is a second, non-colour-dependent cue for the status (same reasoning
 * as StatTile's delta arrow: colour alone excludes roughly 1 in 12 men).
 */

/** Mirrors the icons already established elsewhere (`RotateCcw` for Returns
 *  in the sidebar nav, `Truck` for Delivery) rather than inventing new ones
 *  for the same concepts. */
const STATUS_ICONS = {
  PENDING: Clock,
  CONFIRMED: ShieldCheck,
  SHIPPED: Truck,
  DELIVERED: PackageCheck,
  CANCELED: XCircle,
  RETURNED: RotateCcw,
} satisfies Record<string, LucideIcon>;

interface StatusBreakdownWidgetProps {
  data: StatusBreakdown | null;
  isLoading?: boolean;
}

export function StatusBreakdownWidget({ data, isLoading = false }: StatusBreakdownWidgetProps) {
  const t = useTranslations('reports');
  const tStates = useTranslations('states');
  const tOrderStatus = useTranslations('orderStatus');
  const formatter = useFormatter();
  const formatCurrency = useCurrencyFormat();

  return (
    <section className="bg-card rounded-lg border p-4" aria-label={t('statusBreakdown')}>
      <h2 className="text-sm font-medium">{t('statusBreakdown')}</h2>

      {isLoading ? (
        <div className="mt-3 grid grid-cols-3 gap-4">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      ) : data && data.statuses.length > 0 ? (
        <ul className="mt-3 grid grid-cols-3 gap-y-4">
          {data.statuses.map((row) => {
            const Icon = STATUS_ICONS[row.status as keyof typeof STATUS_ICONS] as
              | LucideIcon
              | undefined;

            return (
              <li key={row.status}>
                {/* The whole cell is the drill-down — a count with nowhere to
                    go is a dead end, same reasoning as StatTile's own href. */}
                <Link
                  href={`/admin/orders?status=${row.status}`}
                  aria-label={t('viewOrdersWithStatus', {
                    status: tOrderStatus.has(row.status) ? tOrderStatus(row.status) : row.status,
                  })}
                  className="hover:bg-muted focus-visible:ring-ring flex flex-col items-center gap-1.5 rounded-md p-1.5 text-center transition-colors focus-visible:ring-2 focus-visible:outline-none"
                >
                  <span className="flex items-center gap-1.5">
                    {Icon ? (
                      <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
                    ) : null}
                    <span className="text-sm font-semibold tabular-nums">
                      {formatter.number(row.orders)}
                    </span>
                  </span>
                  <StatusBadge kind="orderStatus" value={row.status} />
                  {/* Revenue per status — returned by the endpoint and typed,
                      but previously never rendered anywhere (C2.1). Shown
                      small, under the badge: the count is the headline
                      figure for THIS widget, the total is context. */}
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {formatCurrency(Number(row.total))}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-muted-foreground mt-3 text-sm">{tStates('empty.title')}</p>
      )}
    </section>
  );
}
