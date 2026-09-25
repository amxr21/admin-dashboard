'use client';

import { useFormatter, useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { WidgetSection } from '@/components/dashboard/widget-section';
import type { ResourceRow } from '@/lib/resource-api';

interface RecentCustomersWidgetProps {
  rows: ResourceRow[] | null;
  isLoading?: boolean;
}

/** The newest customer records, each linking to its own page. */
export function RecentCustomersWidget({ rows, isLoading = false }: RecentCustomersWidgetProps) {
  const t = useTranslations('dashboard.recentCustomers');
  const formatter = useFormatter();

  return (
    <WidgetSection
      title={t('title')}
      icon="customers"
      tone="accent"
      action={{ href: '/admin/r/customers', label: t('viewAll') }}
    >
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
        </div>
      ) : rows && rows.length > 0 ? (
        <ul className="space-y-3">
          {rows.map((row) => {
            const id = String(row.id);
            const name = typeof row.name === 'string' && row.name ? row.name : null;
            const contact = [row.email, row.phone].find((value) => typeof value === 'string' && value) as
              | string
              | undefined;

            return (
              <li key={id} className="text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <Link
                    // The customer list has no per-row route; filtering it to this
                    // customer is the closest link that still opens their record.
                    href={`/admin/r/customers?search=${encodeURIComponent(contact ?? name ?? '')}`}
                    className="min-w-0 truncate font-medium hover:underline"
                  >
                    {name ?? contact ?? t('unnamed')}
                  </Link>
                  {typeof row.createdAt === 'string' ? (
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {formatter.relativeTime(new Date(row.createdAt))}
                    </span>
                  ) : null}
                </div>
                {name && contact ? (
                  <p className="text-muted-foreground force-ltr mt-0.5 truncate text-start text-xs">{contact}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">{t('empty')}</p>
      )}
    </WidgetSection>
  );
}