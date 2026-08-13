'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { useUrlState } from '@/hooks/useUrlState';
import { FilterChips, type AppliedFilter } from '@/components/filter-chips';
import { RowActions, type RowAction } from '@/components/row-actions';
import { TablePagination } from '@/components/table-pagination';
import { DensityToggle } from '@/components/density-toggle';
import { getGlobalDensity } from '@/lib/apply-appearance';
import { useTableDensity } from '@/hooks/useTableDensity';
import { useAppSettings } from '@/components/providers/settings-provider';
import {
  COURIER_STATUSES,
  fetchCouriers,
  issueAccessCode,
  revokeAccessCode,
  type Courier,
  type CourierListResult,
  type CourierStatus,
} from '@/lib/delivery-api';

const ALL = 'all';

/**
 * Couriers, and the credential each one signs in with.
 *
 * The access code is the reason this is not a generic resource page: issuing
 * one is an action whose response contains a secret that exists exactly once.
 */

/** Defaults are omitted from the URL, so an unfiltered list has a clean one. */
const URL_DEFAULTS = { page: '1', search: '', status: ALL, pageSize: '' };

export function CouriersTable() {
  const t = useTranslations('delivery');
  const tStatus = useTranslations('deliveryStaffStatus');
  const tTable = useTranslations('table');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();
  const { tablePageSize } = useAppSettings();

  /** Per-table density override — see resource-table.tsx / useTableDensity.ts. */
  const { override: densityOverride, setOverride: setDensityOverride } =
    useTableDensity('couriers');

  const [result, setResult] = useState<CourierListResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  /** Page, search and status live in the URL so a filtered view is shareable. */
  const { values, setValues } = useUrlState(URL_DEFAULTS);

  const page = Math.max(1, Number(values.page) || 1);

  /** Overrides `dashboard.tablePageSize` for this view only — see resource-table.tsx. */
  const urlPageSize = Number(values.pageSize);
  const effectivePageSize =
    Number.isFinite(urlPageSize) && urlPageSize > 0 ? urlPageSize : tablePageSize;
  const search = values.search ?? '';
  const status = values.status ?? ALL;

  // Holds raw keystrokes; only the debounced value reaches the URL.
  const [searchInput, setSearchInput] = useState(search);
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
        await fetchCouriers({
          page,
          pageSize: effectivePageSize,
          ...(search ? { search } : {}),
          ...(status !== ALL ? { status: status as CourierStatus } : {}),
        }),
      );
    } catch (caught) {
      setError(translateError(caught));
      setResult(null);
    } finally {
      setIsLoading(false);
    }
  }, [page, search, status, effectivePageSize, translateError]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Debounced so typing doesn't fire a request — or a navigation — per
   * keystroke. The equality guard prevents a redundant write on mount, where
   * the effect would otherwise push back the same value it just read.
   */
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === search) return;

    const timer = setTimeout(() => {
      setValues({ search: trimmed, page: null });
    }, 300);

    return () => clearTimeout(timer);
  }, [searchInput, search, setValues]);

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
          <Link
            href={`/admin/delivery/${courier.id}`}
            className="hover:text-primary block truncate font-medium underline-offset-4 hover:underline"
          >
            {courier.name}
          </Link>
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
      cell: (courier) => {
        const rowActions: RowAction[] = [
          {
            id: 'edit',
            label: t('actions.edit', { name: courier.name }),
            icon: Pencil,
            onClick: () => setEditing(courier),
          },
          ...(courier.hasAccessCode
            ? [
                {
                  id: 'revoke',
                  label: t('actions.revoke', { name: courier.name }),
                  icon: ShieldOff,
                  variant: 'destructive' as const,
                  onClick: () => setConfirmRevoke(courier),
                },
              ]
            : []),
        ];

        return (
          <div className="flex justify-end gap-1">
            {/* Text-labeled, so it stays outside RowActions same as staff's
                unlock button — "Issue" vs "Reissue" is the row's most
                important state and reads badly as a bare icon. */}
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

            <RowActions actions={rowActions} />
          </div>
        );
      },
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

        <div className="w-44 space-y-2">
          <Label htmlFor="courier-status">{t('columns.status')}</Label>
          <Select
            value={status}
            onValueChange={(value) => setValues({ status: value === ALL ? null : value, page: null })}
          >
            <SelectTrigger id="courier-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('filters.allStatuses')}</SelectItem>
              {COURIER_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {tStatus(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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

      <div className="flex items-center justify-between gap-3">
        <FilterChips
          filters={
            [
              search
                ? {
                    id: 'search',
                    label: `${t('search.label')}: ${search}`,
                    onRemove: () => {
                      setSearchInput('');
                      setValues({ search: null, page: null });
                    },
                  }
                : null,
              status !== ALL
                ? {
                    id: 'status',
                    label: `${t('columns.status')}: ${tStatus(status)}`,
                    onRemove: () => setValues({ status: null, page: null }),
                  }
                : null,
            ].filter((filter): filter is AppliedFilter => filter !== null)
          }
        />
        <DensityToggle
          value={densityOverride ?? getGlobalDensity()}
          onChange={setDensityOverride}
          className="ms-auto shrink-0"
        />
      </div>

      <DataTable
        data={result?.couriers ?? []}
        columns={columns}
        getRowId={(courier) => courier.id}
        isLoading={isLoading}
        error={error}
        onRetry={() => void load()}
        density={densityOverride ?? undefined}
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

      {result ? (
        <TablePagination
          page={page}
          totalPages={result.totalPages}
          total={result.total}
          pageSize={effectivePageSize}
          isLoading={isLoading}
          onPageChange={(next) => setValues({ page: String(next) })}
          onPageSizeChange={(next) => setValues({ pageSize: String(next), page: null })}
          totalLabel={t('total', { count: result.total })}
        />
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
