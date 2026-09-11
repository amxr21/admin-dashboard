'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { CheckCheck, ExternalLink, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { EmptyState } from '@/components/empty-state';
import { ErrorSection } from '@/components/errors/error-section';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppSettings } from '@/components/providers/settings-provider';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { useUrlState } from '@/hooks/useUrlState';
import { Link } from '@/i18n/navigation';
import { deleteRow, fetchRows, type ResourceRow } from '@/lib/resource-api';
import { markAllNotificationsRead, markNotificationRead } from '@/lib/notifications-api';
import { announceNotificationsChanged, getSafeNotificationLink } from '@/lib/notification-events';

/**
 * The full notifications list — a bespoke card-based view, not the generic
 * table `/admin/r/notifications` used to render. A row/column table implies
 * fields you compare and sort across records; a notification is a single
 * short message you read once and either keep or dismiss, which reads as a
 * list of cards, not a spreadsheet. The generic engine's `update` is now
 * `false` (see admin.config.ts) — the only actions here are opening one
 * (which marks it read) and dismissing it (delete), matching what a
 * notification actually is.
 */

const PAGE_SIZE = 20;

export function NotificationsList() {
  const t = useTranslations('notificationsPage');
  const tCommon = useTranslations('common');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();
  const { editPanelMode } = useAppSettings();
  const { values, setValues } = useUrlState({ page: '1', search: '', status: 'all' });

  const [rows, setRows] = useState<ResourceRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const page = Math.max(1, Number(values.page) || 1);
  const search = values.search?.trim() ?? '';
  const status = values.status === 'read' || values.status === 'unread' ? values.status : 'all';
  const [searchInput, setSearchInput] = useState(search);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMarkingAll, setIsMarkingAll] = useState(false);
  const [openRow, setOpenRow] = useState<ResourceRow | null>(null);
  const [pendingDelete, setPendingDeleteId] = useState<string | null>(null);

  // Debounced, same 300ms as every other search box in the app.
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = searchInput.trim();
      if (next !== search) setValues({ search: next || null, page: null });
    }, 300);
    return () => clearTimeout(timer);
  }, [search, searchInput, setValues]);

  useEffect(() => setSearchInput(search), [search]);

  const load = useCallback(() => {
    setIsLoading(true);
    setError(null);

    Promise.all([
      fetchRows('notifications', {
        page,
        pageSize: PAGE_SIZE,
        sort: 'createdAt',
        dir: 'desc',
        ...(search ? { search } : {}),
        ...(status === 'all' ? {} : { filters: { isRead: String(status === 'read') } }),
      }),
      fetchRows('notifications', { pageSize: 1, filters: { isRead: 'false' } }),
    ])
      .then(([result, unreadResult]) => {
        setRows(result.rows);
        setTotal(result.total);
        setTotalPages(result.totalPages);
        setUnreadCount(unreadResult.total);
      })
      .catch((caught: unknown) => setError(translateError(caught)))
      .finally(() => setIsLoading(false));
  }, [page, search, status, translateError]);

  useEffect(() => {
    load();
  }, [load]);

  async function markAllRead() {
    setIsMarkingAll(true);
    try {
      await markAllNotificationsRead();
      if (status === 'unread') {
        setRows([]);
        setTotal(0);
        setTotalPages(1);
      } else {
        setRows((current) => current?.map((row) => ({ ...row, isRead: true })) ?? current);
      }
      setUnreadCount(0);
      announceNotificationsChanged();
      toast.success(t('markedAllRead'));
    } catch (caught) {
      toast.error(translateError(caught));
    } finally {
      setIsMarkingAll(false);
    }
  }

  async function openNotification(row: ResourceRow) {
    setOpenRow(row);

    if (!row.isRead) {
      // Optimistic — opening it to read it IS the action, no separate
      // control marks it read.
      setRows((current) =>
        current?.map((item) => (item.id === row.id ? { ...item, isRead: true } : item)) ?? current,
      );
      try {
        await markNotificationRead(String(row.id));
        if (status === 'unread') {
          setRows((current) => current?.filter((item) => item.id !== row.id) ?? current);
          setTotal((current) => Math.max(0, current - 1));
        }
        setUnreadCount((current) => Math.max(0, current - 1));
        announceNotificationsChanged();
      } catch {
        // A failed read-marking must not block reading the content the user
        // already has open in front of them — it just stays unread for next
        // time, which is the safe direction to fail in.
        setRows((current) =>
          current?.map((item) => (item.id === row.id ? { ...item, isRead: false } : item)) ?? current,
        );
      }
    }
  }

  async function dismiss(id: string) {
    try {
      await deleteRow('notifications', id);
      setRows((current) => current?.filter((row) => row.id !== id) ?? current);
      setTotal((current) => Math.max(0, current - 1));
      if (!rows?.find((row) => String(row.id) === id)?.isRead) {
        setUnreadCount((current) => Math.max(0, current - 1));
      }
      announceNotificationsChanged();
      if (openRow?.id === id) setOpenRow(null);
    } catch (caught) {
      toast.error(translateError(caught));
    } finally {
      setPendingDeleteId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1 space-y-2">
          <Label htmlFor="notifications-search">{t('search.label')}</Label>
          <div className="relative">
            <Search
              className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              id="notifications-search"
              value={searchInput}
              onChange={(event) => {
                setSearchInput(event.target.value);
              }}
              placeholder={t('search.placeholder')}
              className="ps-9"
            />
          </div>
        </div>

        <div className="min-w-44 space-y-2">
          <Label htmlFor="notifications-status">{t('filters.label')}</Label>
          <Select
            value={status}
            onValueChange={(value) => setValues({ status: value, page: null }, { history: 'push' })}
          >
            <SelectTrigger id="notifications-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('filters.all')}</SelectItem>
              <SelectItem value="unread">{t('filters.unread')}</SelectItem>
              <SelectItem value="read">{t('filters.read')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          variant="outline"
          disabled={isMarkingAll || unreadCount === 0}
          onClick={() => void markAllRead()}
        >
          <CheckCheck aria-hidden />
          {t('markAllRead')}
        </Button>
      </div>

      {error ? (
        <ErrorSection title={t('loadFailed')} description={error} onRetry={load} />
      ) : isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-20 w-full" />
          ))}
        </div>
      ) : !rows || rows.length === 0 ? (
        <EmptyState title={search ? t('noResults') : t('empty')} />
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => {
            const id = String(row.id);
            const isUnread = !row.isRead;
            const createdAt = row.createdAt ? new Date(String(row.createdAt)) : null;

            return (
              <li key={id} className="bg-card hover:bg-muted/50 flex items-start gap-2 rounded-lg border p-2 transition-colors">
                <button
                  type="button"
                  onClick={() => void openNotification(row)}
                  className="focus-visible:ring-ring flex min-w-0 flex-1 items-start gap-3 rounded-md p-2 text-start outline-none focus-visible:ring-2"
                  aria-label={t('open', { title: String(row.title ?? '') })}
                >
                  <span
                    aria-hidden
                    className={
                      isUnread
                        ? 'bg-primary mt-1.5 size-2 shrink-0 rounded-full'
                        : 'mt-1.5 size-2 shrink-0 rounded-full bg-transparent'
                    }
                  />

                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className={isUnread ? 'font-semibold' : 'font-medium'}>
                      {String(row.title ?? '')}
                    </p>
                    {row.body ? (
                      <p className="text-muted-foreground truncate text-sm">
                        {String(row.body)}
                      </p>
                    ) : null}
                    {createdAt ? (
                      <p className="text-muted-foreground text-xs">
                        {formatter.dateTime(createdAt, 'short')}
                      </p>
                    ) : null}
                  </div>

                </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('dismiss', { title: String(row.title ?? '') })}
                    className="text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => setPendingDeleteId(id)}
                  >
                    <X className="size-4" aria-hidden />
                  </Button>
              </li>
            );
          })}
        </ul>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-between gap-4">
          <p className="text-muted-foreground text-sm tabular-nums">
            {t('total', { count: total })}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || isLoading}
              onClick={() => setValues({ page: String(Math.max(1, page - 1)) }, { history: 'push' })}
            >
              {tCommon('previous')}
            </Button>
            <span className="text-sm tabular-nums">
              {t('pageOf', { page, total: totalPages })}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || isLoading}
              onClick={() => setValues({ page: String(Math.min(totalPages, page + 1)) }, { history: 'push' })}
            >
              {tCommon('next')}
            </Button>
          </div>
        </div>
      ) : null}

      <Sheet open={openRow !== null} onOpenChange={(next) => { if (!next) setOpenRow(null); }}>
        <SheetContent
          side="end"
          variant={editPanelMode}
          className="w-full max-w-md overflow-y-auto"
          title={openRow ? String(openRow.title ?? '') : t('detailTitle')}
        >
          {openRow ? (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-balance">
                  {String(openRow.title ?? '')}
                </h2>
                {openRow.createdAt ? (
                  <p className="text-muted-foreground mt-1 text-sm">
                    {formatter.dateTime(new Date(String(openRow.createdAt)), 'long')}
                  </p>
                ) : null}
              </div>

              {openRow.body ? (
                <p className="text-sm text-pretty">{String(openRow.body)}</p>
              ) : null}

              {getSafeNotificationLink(openRow.link) ? (
                <Button asChild>
                  <Link href={getSafeNotificationLink(openRow.link)!}>
                    <ExternalLink className="icon-directional" aria-hidden />
                    {t('openLink')}
                  </Link>
                </Button>
              ) : null}

              <div className="flex justify-end border-t pt-4">
                <Button
                  variant="outline"
                  onClick={() => setPendingDeleteId(String(openRow.id))}
                >
                  <Trash2 aria-hidden />
                  {t('dismiss', { title: String(openRow.title ?? '') })}
                </Button>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirmDismiss')}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (pendingDelete) void dismiss(pendingDelete);
              }}
            >
              {t('dismissShort')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
