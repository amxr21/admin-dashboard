'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { CheckCheck, Search, Trash2, X } from 'lucide-react';
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
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppSettings } from '@/components/providers/settings-provider';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { deleteRow, fetchRows, type ResourceRow } from '@/lib/resource-api';
import { markAllNotificationsRead, markNotificationRead } from '@/lib/notifications-api';

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

  const [rows, setRows] = useState<ResourceRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMarkingAll, setIsMarkingAll] = useState(false);
  const [openRow, setOpenRow] = useState<ResourceRow | null>(null);
  const [pendingDelete, setPendingDeleteId] = useState<string | null>(null);

  // Debounced, same 300ms as every other search box in the app.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(() => {
    setIsLoading(true);
    setError(null);

    fetchRows('notifications', {
      page,
      pageSize: PAGE_SIZE,
      sort: 'createdAt',
      dir: 'desc',
      ...(search ? { search } : {}),
    })
      .then((result) => {
        setRows(result.rows);
        setTotal(result.total);
        setTotalPages(result.totalPages);
      })
      .catch((caught: unknown) => setError(translateError(caught)))
      .finally(() => setIsLoading(false));
  }, [page, search, translateError]);

  useEffect(() => {
    load();
  }, [load]);

  const unreadCount = rows?.filter((row) => !row.isRead).length ?? 0;

  async function markAllRead() {
    setIsMarkingAll(true);
    try {
      await markAllNotificationsRead();
      setRows((current) => current?.map((row) => ({ ...row, isRead: true })) ?? current);
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
      } catch {
        // A failed read-marking must not block reading the content the user
        // already has open in front of them — it just stays unread for next
        // time, which is the safe direction to fail in.
      }
    }
  }

  async function dismiss(id: string) {
    try {
      await deleteRow('notifications', id);
      setRows((current) => current?.filter((row) => row.id !== id) ?? current);
      setTotal((current) => Math.max(0, current - 1));
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
                setPage(1);
              }}
              placeholder={t('search.placeholder')}
              className="ps-9"
            />
          </div>
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
              <li key={id}>
                {/*
                  B5.3 — this was a `<button>` with a `<span role="button">`
                  dismiss control nested inside it: invalid HTML (interactive
                  content inside interactive content) and unreachable by
                  keyboard as a real button. Now a plain container with two
                  SIBLING real buttons — open (flex-1) and dismiss — so both
                  are natively focusable/activatable and neither is nested in
                  the other.
                */}
                <div className="bg-card hover:bg-muted/50 flex w-full items-start gap-3 rounded-lg border p-4 transition-colors">
                  <button
                    type="button"
                    onClick={() => void openNotification(row)}
                    className="flex min-w-0 flex-1 items-start gap-3 text-start"
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

                  <button
                    type="button"
                    aria-label={t('dismiss', { title: String(row.title ?? '') })}
                    className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0 rounded-md p-1.5"
                    onClick={() => setPendingDeleteId(id)}
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </div>
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
              onClick={() => setPage((current) => Math.max(1, current - 1))}
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
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
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
          className="max-w-md overflow-y-auto"
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

              {openRow.link ? (
                <a
                  href={String(openRow.link)}
                  className="text-primary text-sm underline"
                >
                  {t('openLink')}
                </a>
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
