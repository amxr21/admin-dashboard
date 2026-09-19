'use client';

import { useFormatter, useTranslations } from 'next-intl';

import { Skeleton } from '@/components/ui/skeleton';
import { WidgetSection } from '@/components/dashboard/widget-section';
import { stripDemoTag } from '@/lib/demo';
import type { AuditEntry } from '@/lib/audit-api';

/**
 * A glance at the last few audit entries — the full trail already exists
 * (`/admin/audit`), it just never surfaced on the dashboard. Same data,
 * same "who changed what" framing, five rows instead of a filterable table.
 */
interface RecentActivityWidgetProps {
  entries: AuditEntry[] | null;
  isLoading?: boolean;
}

export function RecentActivityWidget({ entries, isLoading = false }: RecentActivityWidgetProps) {
  const t = useTranslations('dashboard.activity');
  const tStatus = useTranslations('states');
  const formatter = useFormatter();

  return (
    <WidgetSection
      title={t('title')}
      icon="activity"
      tone="neutral"
      live
      action={{ href: '/admin/audit', label: t('viewAll') }}
    >

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
        </div>
      ) : entries && entries.length > 0 ? (
        <ul className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="text-sm">
              <p className="truncate">
                <span className="font-medium">
                  {stripDemoTag(entry.actorEmail) ?? t('system')}
                </span>{' '}
                {/* `action`/`entity` are raw, untranslated strings from the
                    audit log (e.g. "updated products") — same treatment
                    audit-table.tsx already gives them, not a new sentence
                    template this data doesn't actually fit. */}
                <code className="force-ltr text-muted-foreground text-xs">
                  {entry.action} {entry.entity}
                </code>
              </p>
              <p className="text-muted-foreground text-xs tabular-nums">
                {formatter.dateTime(new Date(entry.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">{tStatus('empty.title')}</p>
      )}
    </WidgetSection>
  );
}
