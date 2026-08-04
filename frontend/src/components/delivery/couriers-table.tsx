'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { KeyRound, Pencil, Plus, Search, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { DataTable, type Column } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { AccessCodePanel } from '@/components/delivery/access-code-panel';
import { CourierSheet } from '@/components/delivery/courier-sheet';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { useAppSettings } from '@/components/providers/settings-provider';
import {
  fetchCouriers,
  issueAccessCode,
  revokeAccessCode,
  type Courier,
  type CourierListResult,
} from '@/lib/delivery-api';

/**
 * Couriers, and the credential each one signs in with.
 *
 * The access code is the reason this is not a generic resource page: issuing
 * one is an action whose response contains a secret that exists exactly once.
 */

export function CouriersTable() {
  const t = useTranslations('delivery');
  const tTable = useTranslations('table');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();
  const { tablePageSize } = useAppSettings();

  const [result, setResult] = useState<CourierListResult | null>(null);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<Courier | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [issued, setIssued] = useState<{ name: string; code: string } | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<Courier | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      setResult(
        await fetchCouriers({ page, pageSize: tablePageSize, ...(search ? { search } : {}) }),
      );
    } catch (caught) {
      setError(translateError(caught));
      setResult(null);
    } finally {
      setIsLoading(false);
    }
  }, [page, search, tablePageSize, translateError]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchInput]);

  async function issue(courier: Courier) {
    try {
      const result = await issueAccessCode(courier.id);
      // Held in state only while the panel is open. Never persisted anywhere —
      // the server kept a hash, so nothing can recover it later.
      setIssued({ name: result.courier.name, code: result.code });
      await load();
    } catch (caught) {
      // Action failures are toasts, never `error` — that state is DataTable's
      // "the table itself couldn't load" surface, and hijacking it here would
      // replace every row with a retry box for a problem unrelated to loading.
      //
      // A 400 here is a REASON, not a malfunction — "reactivate this courier
      // before issuing a code". Collapsing it into the generic server message
      // would hide the one sentence that says what to do about it.
      toast.error(
        caught instanceof ApiError && caught.status === 400
          ? caught.message
          : translateError(caught),
      );
    }
  }

  async function revoke(courier: Courier) {
    try {
      await revokeAccessCode(courier.id);
      toast.success(t('notice.revoked', { name: courier.name }));
      setConfirmRevoke(null);
      await load();
    } catch (caught) {
      toast.error(translateError(caught));
    }
  }

  const columns: readonly Column<Courier>[] = [
    {
      id: 'name',
      header: t('columns.courier'),
      cell: (courier) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{courier.name}</p>
          {courier.phone ? (
            <p className="text-muted-foreground force-ltr truncate text-xs">
              {courier.phone}
            </p>
          ) : null}
        </div>
      ),
      sortValue: (courier) => courier.name,
    },
    {
      id: 'zone',
      header: t('columns.zone'),
      cell: (courier) => courier.zone ?? '—',
      sortValue: (courier) => courier.zone ?? null,
    },
    {
      id: 'active',
      header: t('columns.active'),
      align: 'end',
      cell: (courier) => formatter.number(courier.activeAssignments),
      sortValue: (courier) => courier.activeAssignments,
    },
    {
      id: 'code',
      header: t('columns.code'),
      cell: (courier) =>
        courier.hasAccessCode ? (
          <span className="text-success text-sm">{t('code.issued')}</span>
        ) : (
          // Stated rather than blank: a courier with no code cannot sign in,
          // which is a fact about them, not missing data.
          <span className="text-muted-foreground text-sm">{t('code.none')}</span>
        ),
      sortValue: (courier) => String(courier.hasAccessCode),
    },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (courier) => <StatusBadge kind="deliveryStaffStatus" value={courier.status} />,
      sortValue: (courier) => courier.status,
    },
    {
      id: '__actions',
      header: <span className="sr-only">{t('columns.actions')}</span>,
      align: 'end',
      cell: (courier) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('actions.edit', { name: courier.name })}
            onClick={() => setEditing(courier)}
          >
            <Pencil aria-hidden />
          </Button>

          <Button
            variant="outline"
            size="sm"
            aria-label={
              courier.hasAccessCode
                ? t('actions.reissue', { name: courier.name })
                : t('actions.issue', { name: courier.name })
            }
            onClick={() => void issue(courier)}
          >
            <KeyRound aria-hidden />
            {courier.hasAccessCode ? t('actions.reissueShort') : t('actions.issueShort')}
          </Button>

          {courier.hasAccessCode ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('actions.revoke', { name: courier.name })}
              onClick={() => setConfirmRevoke(courier)}
            >
              <ShieldOff aria-hidden />
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1 space-y-2">
          <Label htmlFor="courier-search">{t('search.label')}</Label>
          <div className="relative">
            <Search
              className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              id="courier-search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={t('search.placeholder')}
              className="ps-9"
            />
          </div>
        </div>

        <Button onClick={() => setIsCreating(true)}>
          <Plus aria-hidden />
          {t('actions.create')}
        </Button>
      </div>

      {issued ? (
        <AccessCodePanel
          courierName={issued.name}
          code={issued.code}
          onDone={() => setIssued(null)}
        />
      ) : null}

      <AlertDialog
        open={confirmRevoke !== null}
        onOpenChange={(next) => {
          if (!next) setConfirmRevoke(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('revoke.title', { name: confirmRevoke?.name ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('revoke.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('revoke.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (confirmRevoke) void revoke(confirmRevoke);
              }}
            >
              {t('revoke.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DataTable
        data={result?.couriers ?? []}
        columns={columns}
        getRowId={(courier) => courier.id}
        isLoading={isLoading}
        error={error}
        onRetry={() => void load()}
        emptyMessage={
          search ? (
            tTable('noResults')
          ) : (
            <EmptyState
              title={t('empty')}
              action={{ label: t('actions.create'), onClick: () => setIsCreating(true) }}
            />
          )
        }
      />

      {result && result.totalPages > 1 ? (
        <div className="flex items-center justify-between gap-4">
          <p className="text-muted-foreground text-sm tabular-nums">
            {t('total', { count: result.total })}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || isLoading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              {t('pagination.previous')}
            </Button>
            <span className="text-sm tabular-nums">
              {tTable('pageOf', { page, total: result.totalPages })}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= result.totalPages || isLoading}
              onClick={() =>
                setPage((current) => Math.min(result.totalPages, current + 1))
              }
            >
              {t('pagination.next')}
            </Button>
          </div>
        </div>
      ) : null}

      <CourierSheet
        courier={editing}
        open={isCreating || editing !== null}
        onOpenChange={(next) => {
          if (!next) {
            setIsCreating(false);
            setEditing(null);
          }
        }}
        onSaved={(message) => {
          toast.success(message);
          void load();
        }}
      />
    </div>
  );
}
