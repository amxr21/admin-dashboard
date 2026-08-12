'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { MessageSquareWarning, PackageX, RotateCcw, Truck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { stripDemoTag } from '@/lib/demo';
import type { NeedsAttention } from '@/lib/reports-api';

/**
 * C1.5 — one queue, four sources. Each category answers "what's stuck right
 * now and needs a human", pulled together because a staff member checking
 * "what needs my attention today" shouldn't have to visit four separate
 * pages to find out. See `getNeedsAttention` (reports.service.ts) for why
 * this is deliberately LIVE state, not scoped to the dashboard's date range.
 *
 * Two categories are NOT here — payments pending capture, and failed/past-
 * ETA deliveries — because this schema cannot honestly answer either yet
 * (`paymentMethod` has no capture-state model; `DeliveryStatus` has no
 * FAILED value). Adding UI for them would mean inventing data.
 *
 * Four separate sections rather than one data-driven loop over the
 * categories: each bucket has a genuinely different item shape (an RMA
 * number, a rating, an order number, a SKU), and a generic `render(item)`
 * callback shared across all four would need an unsafe cast to recover that
 * shape inside each callback — more code here, but every line is real
 * static types with nothing "trust me" about it.
 */

interface NeedsAttentionWidgetProps {
  data: NeedsAttention | null;
  isLoading?: boolean;
}

const MAX_PREVIEW_ITEMS = 3;

export function NeedsAttentionWidget({ data, isLoading = false }: NeedsAttentionWidgetProps) {
  const t = useTranslations('dashboard.needsAttention');
  const tStates = useTranslations('states');

  const totalCount = data
    ? data.returnsAwaitingApproval.count +
      data.reviewsAwaitingModeration.count +
      data.unassignedDeliveries.count +
      data.outOfStockWithOpenOrders.count
    : 0;

  return (
    <section className="bg-card rounded-lg border p-4" aria-label={t('title')}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">{t('title')}</h2>
        {data && totalCount > 0 ? (
          <span className="bg-destructive/10 text-destructive rounded-full px-2 py-0.5 text-xs font-medium tabular-nums">
            {totalCount}
          </span>
        ) : null}
      </div>

      {isLoading ? (
        <div className="mt-3 space-y-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-6 w-full" />
          ))}
        </div>
      ) : !data ? (
        <p className="text-muted-foreground mt-3 text-sm">{tStates('empty.title')}</p>
      ) : totalCount === 0 ? (
        <p className="text-muted-foreground mt-3 text-sm">{t('allClear')}</p>
      ) : (
        <div className="mt-3 space-y-4">
          <CategorySection
            icon={RotateCcw}
            href="/admin/returns?status=REQUESTED"
            label={t('categories.returnsAwaitingApproval', {
              count: data.returnsAwaitingApproval.count,
            })}
            count={data.returnsAwaitingApproval.count}
          >
            {data.returnsAwaitingApproval.items.slice(0, MAX_PREVIEW_ITEMS).map((row) => (
              <Row key={row.id} title={stripDemoTag(row.rmaNumber)} subtitle={stripDemoTag(row.orderNumber)} />
            ))}
          </CategorySection>

          <CategorySection
            icon={MessageSquareWarning}
            href="/admin/r/reviews?f_status=PENDING"
            label={t('categories.reviewsAwaitingModeration', {
              count: data.reviewsAwaitingModeration.count,
            })}
            count={data.reviewsAwaitingModeration.count}
          >
            {data.reviewsAwaitingModeration.items.slice(0, MAX_PREVIEW_ITEMS).map((row) => (
              <Row
                key={row.id}
                title={row.productName ? stripDemoTag(row.productName) : t('deletedProduct')}
                subtitle={t('rating', { rating: row.rating })}
              />
            ))}
          </CategorySection>

          <CategorySection
            icon={Truck}
            href="/admin/orders"
            label={t('categories.unassignedDeliveries', { count: data.unassignedDeliveries.count })}
            count={data.unassignedDeliveries.count}
          >
            {data.unassignedDeliveries.items.slice(0, MAX_PREVIEW_ITEMS).map((row) => (
              <Row key={row.id} title={stripDemoTag(row.orderNumber)} />
            ))}
          </CategorySection>

          <CategorySection
            icon={PackageX}
            href="/admin/inventory?lowStock=true"
            label={t('categories.outOfStockWithOpenOrders', {
              count: data.outOfStockWithOpenOrders.count,
            })}
            count={data.outOfStockWithOpenOrders.count}
          >
            {data.outOfStockWithOpenOrders.items.slice(0, MAX_PREVIEW_ITEMS).map((row) => (
              <Row key={row.id} title={stripDemoTag(row.name)} subtitle={row.sku ?? undefined} />
            ))}
          </CategorySection>
        </div>
      )}
    </section>
  );
}

function CategorySection({
  icon: Icon,
  href,
  label,
  count,
  children,
}: {
  icon: LucideIcon;
  href: string;
  label: string;
  count: number;
  children: ReactNode;
}) {
  const t = useTranslations('dashboard.needsAttention');

  // Renders nothing (not even the heading) when this bucket is empty — an
  // empty "Reviews awaiting moderation" heading above nothing reads as a
  // rendering bug, same discipline `sidebar-nav.tsx` applies to a
  // permission-emptied nav group.
  if (count === 0) return null;

  return (
    <div className="space-y-2">
      <Link
        href={href}
        className="hover:text-foreground text-muted-foreground flex items-center gap-1.5 text-xs font-medium hover:underline"
      >
        <Icon className="size-3.5 shrink-0" aria-hidden />
        {label}
      </Link>
      <ul className="space-y-1.5 ps-5">{children}</ul>
      {count > MAX_PREVIEW_ITEMS ? (
        <Link href={href} className="text-primary ps-5 block text-xs hover:underline">
          {t('viewAll', { count })}
        </Link>
      ) : null}
    </div>
  );
}

function Row({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <li className="flex items-center justify-between gap-3 text-sm">
      <span className="min-w-0 truncate">{title}</span>
      {subtitle ? <span className="text-muted-foreground shrink-0 text-xs">{subtitle}</span> : null}
    </li>
  );
}
