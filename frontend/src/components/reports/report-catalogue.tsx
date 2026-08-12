'use client';

import { useTranslations } from 'next-intl';
import {
  Boxes,
  CalendarClock,
  LineChart,
  RotateCcw,
  Shield,
  SlidersHorizontal,
  Truck,
  Users,
  UserSquare2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

/**
 * The report catalogue (C3.1) — every report grouped by domain, each a
 * name + one-line description + a link to open it.
 *
 * ─── STILL NO "LAST RUN" COLUMN ON EACH CARD ──────────────────────────
 * The spec calls for one; C3.2 (scheduled reports, since built) makes a
 * "last run" concept real for a SCHEDULE — `lastRunAt` on a
 * `ScheduledReport` row — but a report itself can have zero, one, or many
 * schedules pointed at it, so "this report's last run" has no single
 * honest answer at the catalogue level. The schedules list (linked below)
 * is where a real, unambiguous "last run" lives, per schedule.
 *
 * Static, not backend-driven: unlike the resource engine's config-driven
 * catalogue, a report isn't a table with a field list — it has its own
 * fetch, its own layout, its own CSV shape. A registry entry here just
 * points at the page that already knows how to render itself.
 */

interface ReportEntry {
  href: string;
  titleKey: string;
  descriptionKey: string;
}

interface ReportDomain {
  labelKey: string;
  icon: LucideIcon;
  reports: ReportEntry[];
}

const DOMAINS: ReportDomain[] = [
  {
    labelKey: 'sales',
    icon: LineChart,
    reports: [
      { href: '/admin/reports/overview', titleKey: 'overview.title', descriptionKey: 'overview.description' },
      {
        href: '/admin/reports/category-breakdown',
        titleKey: 'categoryBreakdown.title',
        descriptionKey: 'categoryBreakdown.description',
      },
      {
        href: '/admin/reports/payment-method-breakdown',
        titleKey: 'paymentMethodBreakdown.title',
        descriptionKey: 'paymentMethodBreakdown.description',
      },
      {
        href: '/admin/reports/product-margin',
        titleKey: 'productMargin.title',
        descriptionKey: 'productMargin.description',
      },
      {
        href: '/admin/reports/product-review-summary',
        titleKey: 'productReviewSummary.title',
        descriptionKey: 'productReviewSummary.description',
      },
      {
        href: '/admin/reports/review-moderation-throughput',
        titleKey: 'reviewModerationThroughput.title',
        descriptionKey: 'reviewModerationThroughput.description',
      },
      {
        href: '/admin/reports/products-without-reviews',
        titleKey: 'productsWithoutReviews.title',
        descriptionKey: 'productsWithoutReviews.description',
      },
    ],
  },
  {
    labelKey: 'customers',
    icon: UserSquare2,
    reports: [
      {
        href: '/admin/reports/customer-geography',
        titleKey: 'customerGeography.title',
        descriptionKey: 'customerGeography.description',
      },
      {
        href: '/admin/reports/customer-new-vs-returning',
        titleKey: 'customerNewVsReturning.title',
        descriptionKey: 'customerNewVsReturning.description',
      },
      {
        href: '/admin/reports/customer-lifetime-value',
        titleKey: 'customerLifetimeValue.title',
        descriptionKey: 'customerLifetimeValue.description',
      },
      {
        href: '/admin/reports/customer-order-frequency',
        titleKey: 'customerOrderFrequency.title',
        descriptionKey: 'customerOrderFrequency.description',
      },
      {
        href: '/admin/reports/guest-vs-registered',
        titleKey: 'guestVsRegistered.title',
        descriptionKey: 'guestVsRegistered.description',
      },
    ],
  },
  {
    labelKey: 'inventory',
    icon: Boxes,
    reports: [
      {
        href: '/admin/reports/inventory-turnover',
        titleKey: 'inventoryTurnover.title',
        descriptionKey: 'inventoryTurnover.description',
      },
      {
        href: '/admin/reports/low-stock-snapshot',
        titleKey: 'lowStockSnapshot.title',
        descriptionKey: 'lowStockSnapshot.description',
      },
      {
        href: '/admin/reports/stock-adjustment-reasons',
        titleKey: 'stockAdjustmentReasons.title',
        descriptionKey: 'stockAdjustmentReasons.description',
      },
      {
        href: '/admin/reports/variant-stock-movement',
        titleKey: 'variantStockMovement.title',
        descriptionKey: 'variantStockMovement.description',
      },
    ],
  },
  {
    labelKey: 'returns',
    icon: RotateCcw,
    reports: [
      {
        href: '/admin/reports/refund-rate-trend',
        titleKey: 'refundRateTrend.title',
        descriptionKey: 'refundRateTrend.description',
      },
      {
        href: '/admin/reports/return-resolution-breakdown',
        titleKey: 'returnResolutionBreakdown.title',
        descriptionKey: 'returnResolutionBreakdown.description',
      },
      {
        href: '/admin/reports/return-reasons',
        titleKey: 'returnReasons.title',
        descriptionKey: 'returnReasons.description',
      },
    ],
  },
  {
    labelKey: 'delivery',
    icon: Truck,
    reports: [
      {
        href: '/admin/reports/courier-performance',
        titleKey: 'courierPerformance.title',
        descriptionKey: 'courierPerformance.description',
      },
      {
        href: '/admin/reports/delivery-zone-breakdown',
        titleKey: 'deliveryZoneBreakdown.title',
        descriptionKey: 'deliveryZoneBreakdown.description',
      },
      {
        href: '/admin/reports/delivery-cycle-time',
        titleKey: 'deliveryCycleTime.title',
        descriptionKey: 'deliveryCycleTime.description',
      },
      {
        href: '/admin/reports/courier-workload-snapshot',
        titleKey: 'courierWorkloadSnapshot.title',
        descriptionKey: 'courierWorkloadSnapshot.description',
      },
    ],
  },
  {
    labelKey: 'staff',
    icon: Users,
    reports: [
      { href: '/admin/reports/staff-activity', titleKey: 'staffActivity.title', descriptionKey: 'staffActivity.description' },
    ],
  },
  {
    labelKey: 'security',
    icon: Shield,
    reports: [
      {
        href: '/admin/reports/audit-outcome-trend',
        titleKey: 'auditOutcomeTrend.title',
        descriptionKey: 'auditOutcomeTrend.description',
      },
      {
        href: '/admin/reports/audit-activity-by-entity',
        titleKey: 'auditActivityByEntity.title',
        descriptionKey: 'auditActivityByEntity.description',
      },
    ],
  },
];

export function ReportCatalogue() {
  const t = useTranslations('reports');
  const tDomains = useTranslations('reports.catalogue.domains');
  const tCatalogue = useTranslations('reports.catalogue');

  return (
    <div className="space-y-8">
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin/reports/explorer">
            <SlidersHorizontal className="size-4" aria-hidden />
            {tCatalogue('openExplorer')}
          </Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin/reports/scheduled">
            <CalendarClock className="size-4" aria-hidden />
            {tCatalogue('manageSchedules')}
          </Link>
        </Button>
      </div>

      {DOMAINS.map((domain) => (
        <section key={domain.labelKey} aria-labelledby={`report-domain-${domain.labelKey}`}>
          <div className="mb-3 flex items-center gap-2">
            <domain.icon className="text-muted-foreground size-4" aria-hidden />
            <h2 id={`report-domain-${domain.labelKey}`} className="text-sm font-semibold tracking-tight">
              {tDomains(domain.labelKey)}
            </h2>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {domain.reports.map((report) => (
              <Link
                key={report.href}
                href={report.href}
                className="bg-card hover:border-primary/40 hover:bg-primary/5 group rounded-lg border p-4 transition-colors"
              >
                <p className="group-hover:text-primary font-medium">{t(report.titleKey)}</p>
                <p className="text-muted-foreground mt-1 text-sm">{t(report.descriptionKey)}</p>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
