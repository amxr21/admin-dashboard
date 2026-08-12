'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Bell, CheckCheck } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { fetchRows, type ResourceRow } from '@/lib/resource-api';
import { markAllNotificationsRead } from '@/lib/notifications-api';

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
 * ─── A PREVIEW, NOT A SECOND IMPLEMENTATION OF THE LIST PAGE ─────────
 * The dropdown shows the most recent few unread rows and a "mark all as
 * read" action — both read through the generic `fetchRows('notifications')`
 * client, the same one the bespoke `/admin/notifications` page (a card
 * list, not the old generic table — see notifications-list.tsx) uses. This
 * is a pointer to that page with a shortcut for the one bulk action the
 * generic engine has no vocabulary for (see notifications.route.ts).
 */

/** Above this the exact number stops being useful and the badge gets wide. */
const MAX_BADGE = 99;
const PREVIEW_COUNT = 5;
/**
 * B5.1/B5.2 — the count used to be fetched once on mount and never again, so
 * it went stale the moment a notification arrived, or the moment the FULL
 * list page (a separate component/route) marked something read. Polling plus
 * a focus-revalidate covers both without wiring cross-component state for a
 * badge counter.
 */
const POLL_INTERVAL_MS = 30_000;

export function NotificationsBell() {
  const t = useTranslations('notificationsBell');
  const formatter = useFormatter();
  const [unread, setUnread] = useState<number | null>(null);
  const [preview, setPreview] = useState<ResourceRow[] | null>(null);
  const [isMarking, setIsMarking] = useState(false);
  const [open, setOpen] = useState(false);

  function refreshCount() {
    fetchRows('notifications', { pageSize: 1, filters: { isRead: 'false' } })
      .then((result) => setUnread(result.total))
      .catch(() => {
        // A failing count must not break the shell on every page. The bell
        // stays, without a badge — an unknown count and a zero count look the
        // same here, which is the right trade for a decoration.
        setUnread(null);
      });
  }

  useEffect(() => {
    refreshCount();

    const interval = setInterval(refreshCount, POLL_INTERVAL_MS);
    // Coming back to the tab is the highest-value moment to refresh — it's
    // exactly when a stale count is most likely (time passed, notifications
    // may have arrived, or the user marked things read on another tab/page).
    document.addEventListener('visibilitychange', onVisibilityChange);

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') refreshCount();
    }

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    fetchRows('notifications', {
      pageSize: PREVIEW_COUNT,
      sort: 'createdAt',
      dir: 'desc',
      filters: { isRead: 'false' },
    })
      .then((result) => {
        if (!cancelled) setPreview(result.rows);
      })
      .catch(() => {
        if (!cancelled) setPreview([]);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  async function markAllRead() {
    setIsMarking(true);
    try {
      await markAllNotificationsRead();
      setUnread(0);
      setPreview([]);
    } catch {
      // Nothing to recover into here beyond leaving the count as-is — the
      // user can retry from the same dropdown.
    } finally {
      setIsMarking(false);
    }
  }

  const hasUnread = unread !== null && unread > 0;
  const label = hasUnread ? t('unread', { count: unread }) : t('none');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="relative" aria-label={label}>
              {/* A bell is symmetric — never .icon-directional. */}
              <Bell aria-hidden />

              {hasUnread ? (
                <span
                  aria-hidden
                  // `top-0`, not a negative offset: the badge must stay inside the
                  // button's own box. A negative offset had it visually clipping
                  // at the viewport's top edge under the old sticky-positioned
                  // header — see the Phase 1 scroll-model rebuild.
                  className="bg-destructive text-destructive-foreground absolute top-0 end-0 flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-4 font-medium tabular-nums"
                >
                  {unread > MAX_BADGE ? `${formatter.number(MAX_BADGE)}+` : formatter.number(unread)}
                </span>
              ) : null}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>

      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <p className="text-sm font-medium">{t('title')}</p>
          {hasUnread ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={isMarking}
              onClick={() => void markAllRead()}
            >
              <CheckCheck aria-hidden />
              {t('markAllRead')}
            </Button>
          ) : null}
        </div>

        <div className="max-h-80 overflow-y-auto">
          {preview === null ? (
            <p className="text-muted-foreground p-4 text-center text-sm">{t('loading')}</p>
          ) : preview.length === 0 ? (
            <p className="text-muted-foreground p-4 text-center text-sm">{t('empty')}</p>
          ) : (
            <ul>
              {preview.map((row) => {
                const id = String(row.id);
                const title = String(row.title ?? '');
                const createdAt = row.createdAt ? new Date(String(row.createdAt)) : null;

                return (
                  <li key={id} className="border-b px-3 py-2 text-sm last:border-0">
                    <p className="truncate font-medium">{title}</p>
                    {createdAt ? (
                      <p className="text-muted-foreground text-xs">
                        {formatter.dateTime(createdAt, 'short')}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t p-2">
          <Button variant="ghost" size="sm" asChild className="w-full justify-center">
            <Link href="/admin/notifications" onClick={() => setOpen(false)}>
              {t('viewAll')}
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
