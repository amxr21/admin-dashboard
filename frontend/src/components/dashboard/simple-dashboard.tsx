'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Rocket } from 'lucide-react';

import { AttentionPills } from '@/components/dashboard/attention-pills';
import { FulfillmentHealthWidget } from '@/components/dashboard/fulfillment-health-widget';
import { LatestOrdersWidget } from '@/components/dashboard/latest-orders-widget';
import { LowStockWidget } from '@/components/dashboard/low-stock-widget';
import { QuickActions } from '@/components/dashboard/quick-actions';
import { RecentCustomersWidget } from '@/components/dashboard/recent-customers-widget';
import { StatTile } from '@/components/dashboard/stat-tile';
import { RefreshButton } from '@/components/refresh-button';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from '@/i18n/navigation';
import { useAppSettings } from '@/components/providers/settings-provider';
import { useCanAccessArea } from '@/components/providers/role-permissions-provider';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import type { StaffRole } from '@/config/areas';
import { fetchOrders, type OrderListRow } from '@/lib/orders-api';
import { fetchRows, type ResourceRow } from '@/lib/resource-api';
import {
  fetchFulfillmentHealth,
  fetchLowStockSnapshot,
  fetchNeedsAttention,
  fetchOverview,
  toIsoDate,
  type FulfillmentHealth,
  type LowStockSnapshot,
  type NeedsAttention,
  type Overview,
} from '@/lib/reports-api';

interface SimpleDashboardProps {
  role: StaffRole | null;
  /** Rendered beside the refresh control — the mode toggle. */
  controls: React.ReactNode;
}

/**
 * The simplified dashboard: today, what needs doing, and the shortcuts to do
 * it. No date range, no comparisons and no charts — those stay on the
 * Detailed view and under Reports. Every panel is still branch-scoped by the
 * server, and each is loaded only when the effective role can read it.
 */
export function SimpleDashboard({ role, controls }: SimpleDashboardProps) {
  const t = useTranslations('dashboard');
  const translateError = useTranslatedApiError();
  const canAccessArea = useCanAccessArea();
  const { enabledFeatures } = useAppSettings();

  const canSeeReports = role !== null && canAccessArea(role, 'reports');
  const canSeeOrders = role !== null && canAccessArea(role, 'orders');
  const canSeeCustomers = role !== null && canAccessArea(role, 'customers');
  const tracksInventory = enabledFeatures.inventory !== false;
  const hasDelivery = enabledFeatures.delivery !== false;

  const today = useMemo(() => {
    const date = toIsoDate(new Date());
    return { from: date, to: date };
  }, []);

  const [overview, setOverview] = useState<Overview | null>(null);
  const [attention, setAttention] = useState<NeedsAttention | null>(null);
  const [lowStock, setLowStock] = useState<LowStockSnapshot | null>(null);
  const [fulfillment, setFulfillment] = useState<FulfillmentHealth | null>(null);
  const [orders, setOrders] = useState<OrderListRow[] | null>(null);
  const [customers, setCustomers] = useState<ResourceRow[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Only what this role may read — a request that would 403 is never sent.
      const [loadedOverview, loadedAttention, loadedLowStock, loadedFulfillment, loadedOrders, loadedCustomers] =
        await Promise.all([
          canSeeReports ? fetchOverview(today) : Promise.resolve(null),
          canSeeReports ? fetchNeedsAttention() : Promise.resolve(null),
          canSeeReports && tracksInventory ? fetchLowStockSnapshot() : Promise.resolve(null),
          canSeeReports && hasDelivery ? fetchFulfillmentHealth(today) : Promise.resolve(null),
          canSeeOrders ? fetchOrders({ page: 1, pageSize: 5, sort: 'placedAt', dir: 'desc' }) : Promise.resolve(null),
          canSeeCustomers
            ? fetchRows('customers', { pageSize: 5, sort: 'createdAt', dir: 'desc' })
            : Promise.resolve(null),
        ]);

      setOverview(loadedOverview);
      setAttention(loadedAttention);
      setLowStock(loadedLowStock);
      setFulfillment(loadedFulfillment);
      setOrders(loadedOrders?.orders ?? null);
      setCustomers(loadedCustomers?.rows ?? null);
      setLastUpdated(new Date());
    } catch (caught) {
      setError(translateError(caught));
    } finally {
      setIsLoading(false);
    }
  }, [canSeeReports, canSeeOrders, canSeeCustomers, tracksInventory, hasDelivery, today, translateError]);

  useEffect(() => {
    void load();
  }, [load]);

  // A business that has never taken an order gets its first steps rather
  // than a page of zeros.
  const isNewBusiness = !isLoading && canSeeOrders && orders !== null && orders.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t('simple.title')}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <RefreshButton onRefresh={() => void load()} isLoading={isLoading} lastUpdated={lastUpdated} />
          {controls}
        </div>
      </div>

      {error ? (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
          {error}
        </p>
      ) : null}

      {isNewBusiness ? (
        <section className="bg-card rounded-lg border p-5 shadow-xs" aria-labelledby="first-steps-title">
          <div className="flex items-start gap-3">
            <span className="bg-primary/10 text-primary grid size-9 shrink-0 place-items-center rounded-lg" aria-hidden>
              <Rocket className="size-4" />
            </span>
            <div className="min-w-0">
              <h3 id="first-steps-title" className="font-semibold">
                {t('simple.firstSteps.title')}
              </h3>
              <p className="text-muted-foreground mt-1 text-sm">{t('simple.firstSteps.body')}</p>
              <Button asChild size="sm" className="mt-3">
                <Link href="/admin/guide/checklists">{t('simple.firstSteps.action')}</Link>
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      {canSeeReports ? (
        <div className="grid grid-cols-12 gap-4">
          {isLoading || !overview ? (
            Array.from({ length: 2 }, (_, index) => (
              <Skeleton key={index} className="col-span-12 h-28 w-full sm:col-span-6" />
            ))
          ) : (
            <>
              <div className="col-span-12 sm:col-span-6">
                <StatTile
                  labelKey="todaySales"
                  definition={t('definitions.todaySales')}
                  value={Number(overview.revenue)}
                  format="currency"
                  icon="revenue"
                  noDeltaReason={t('simple.todayOnly')}
                  href="/admin/orders"
                />
              </div>
              <div className="col-span-12 sm:col-span-6">
                <StatTile
                  labelKey="todayOrders"
                  definition={t('definitions.todayOrders')}
                  value={overview.orders}
                  icon="orders"
                  noDeltaReason={t('simple.todayOnly')}
                  href="/admin/orders"
                />
              </div>
            </>
          )}
        </div>
      ) : null}

      {canSeeReports ? <AttentionPills data={attention} isLoading={isLoading} /> : null}

      <QuickActions role={role} />

      <div className="grid grid-cols-12 items-start gap-x-8 gap-y-7">
        {canSeeOrders ? (
          <div className="col-span-12 lg:col-span-6">
            <LatestOrdersWidget orders={orders} isLoading={isLoading} />
          </div>
        ) : null}
        {canSeeReports && hasDelivery ? (
          <div className="col-span-12 lg:col-span-6">
            <FulfillmentHealthWidget data={fulfillment} isLoading={isLoading} />
          </div>
        ) : null}
        {canSeeReports && tracksInventory ? (
          <div className="col-span-12 lg:col-span-6">
            <LowStockWidget data={lowStock} isLoading={isLoading} />
          </div>
        ) : null}
        {canSeeCustomers ? (
          <div className="col-span-12 lg:col-span-6">
            <RecentCustomersWidget rows={customers} isLoading={isLoading} />
          </div>
        ) : null}
      </div>

      {canSeeReports ? (
        <p className="text-muted-foreground text-sm">
          {t('simple.moreInReports')}{' '}
          <Link href="/admin/reports" className="text-primary font-medium hover:underline">
            {t('viewReports')}
          </Link>
        </p>
      ) : null}
    </div>
  );
}