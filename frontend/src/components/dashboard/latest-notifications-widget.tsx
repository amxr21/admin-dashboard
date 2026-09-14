'use client';

import { useFormatter, useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import type { ResourceRow } from '@/lib/resource-api';

/**
 * The newest alerts, on the page an owner actually opens first.
 *
 * ─── WHY NOT JUST THE BELL ───────────────────────────────────────────
 * The bell shows UNREAD only, and it shows them behind a click. An owner
 * opening the dashboard after a day away wants the recent ones regardless of
 * whether somebody else already marked them read — "what has been happening"
 * is a different question from "what is outstanding", and the bell answers
 * only the second.
 *
 * Rows come from the generic engine (`fetchRows('notifications')`), which now
 * scopes them to the active branch server-side — including the branch-less
 * install-wide ones, which must never be hidden by picking a branch. See
 * `branchScopeField` in admin.config.ts.
 */
interface LatestNotificationsWidgetProps {
  rows: ResourceRow[] | null;
  isLoading?: boolean;
}

/** The engine returns `Record<string, unknown>`; read each field defensively
 *  rather than casting the row to a shape the API never promised. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export function LatestNotificationsWidget({
  rows,
  isLoading = false,
}: LatestNotificationsWidgetProps) {
  const t = useTranslations('dashboard.latestNotifications');
  const formatter = useFormatter();

  return (
    <section className="bg-card rounded-lg border p-4" aria-label={t('title')}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">{t('title')}</h2>
        <Link
          href="/admin/notifications"
          className="text-muted-foreground text-xs hover:underline"
        >
          {t('viewAll')}
        </Link>
      </div>

      {isLoading ? (
        <div className="mt-3 space-y-2">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
        </div>
      ) : rows && rows.length > 0 ? (
        <ul className="mt-3 space-y-3">
          {rows.map((row, index) => {
            const id = text(row.id) ?? `row-${String(index)}`;
            const title = text(row.title);
            const createdAt = text(row.createdAt);
            const isRead = row.isRead === true;

            return (
              <li key={id} className="text-sm">
                <p className="flex items-baseline gap-2">
                  {/* Unread gets a dot rather than bold text: several bold
                      rows in a row stop reading as emphasis. */}
                  {isRead ? null : (
                    <span
                      className="bg-primary mt-1.5 size-1.5 shrink-0 rounded-full"
                      aria-hidden
                    />
                  )}
                  <span className="min-w-0 truncate">{title ?? t('untitled')}</span>
                </p>
                {createdAt ? (
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {formatter.relativeTime(new Date(createdAt))}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-muted-foreground mt-3 text-sm">{t('empty')}</p>
      )}
    </section>
  );
}
