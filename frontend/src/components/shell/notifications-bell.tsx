'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Bell } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { fetchRows } from '@/lib/resource-api';

/**
 * Unread notifications, in the top bar.
 *
 * ─── WHY THE TOP BAR AND NOT THE SIDEBAR ─────────────────────────────
 * The sidebar answers "where can I go" — a stable list of places. A
 * notification count answers "has something happened", which changes while you
 * work and needs to be visible from every page. Buried in a nav group it is
 * only seen by someone already looking at the nav, which is exactly the person
 * who does not need telling.
 *
 * The full list is still the generic resource page. This is a pointer to it
 * with a count, not a second implementation of it.
 */

/** Above this the exact number stops being useful and the badge gets wide. */
const MAX_BADGE = 99;

export function NotificationsBell() {
  const t = useTranslations('notificationsBell');
  const formatter = useFormatter();
  const [unread, setUnread] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    // pageSize 1: only `total` is wanted, so there is no reason to transfer
    // rows the bell will never render.
    fetchRows('notifications', { pageSize: 1, filters: { isRead: 'false' } })
      .then((result) => {
        if (!cancelled) setUnread(result.total);
      })
      .catch(() => {
        // A failing count must not break the shell on every page. The bell
        // stays, without a badge — an unknown count and a zero count look the
        // same here, which is the right trade for a decoration.
        if (!cancelled) setUnread(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const hasUnread = unread !== null && unread > 0;

  return (
    <Button
      variant="ghost"
      size="icon"
      asChild
      // The count goes in the accessible name: a screen reader gets "3 unread
      // notifications", not "notifications" with a badge it cannot see.
      aria-label={hasUnread ? t('unread', { count: unread }) : t('none')}
    >
      <Link href="/admin/r/notifications" className="relative">
        {/* A bell is symmetric — never .icon-directional. */}
        <Bell aria-hidden />

        {hasUnread ? (
          <span
            aria-hidden
            className="bg-destructive text-destructive-foreground absolute -top-0.5 end-0 flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-4 font-medium tabular-nums"
          >
            {unread > MAX_BADGE ? `${formatter.number(MAX_BADGE)}+` : formatter.number(unread)}
          </span>
        ) : null}
      </Link>
    </Button>
  );
}
