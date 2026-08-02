'use client';

import { useFormatter, useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { Skeleton } from '@/components/ui/skeleton';
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
    <section className="bg-card rounded-lg border p-4" aria-label={t('title')}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">{t('title')}</h2>
        <Link href="/admin/audit" className="text-muted-foreground text-xs hover:underline">
          {t('viewAll')}
        </Link>
      </div>

      {isLoading ? (
        <div className="mt-3 space-y-2">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
        </div>
      ) : entries && entries.length > 0 ? (
        <ul className="mt-3 space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="text-sm">
              <p className="truncate">
                <span className="font-medium">{entry.actorEmail ?? t('system')}</span>{' '}
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
        <p className="text-muted-foreground mt-3 text-sm">{tStatus('empty.title')}</p>
      )}
    </section>
  );
}
