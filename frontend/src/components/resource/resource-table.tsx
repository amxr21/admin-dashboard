'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useGSAP } from '@gsap/react';
import { History, Pencil, Plus, Search, Trash2 } from 'lucide-react';
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
import { ResourceCell } from '@/components/resource/resource-cell';
import { ResourceForm } from '@/components/resource/resource-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { canAccessArea, type StaffRole } from '@/config/areas';
import { useAuth } from '@/hooks/useAuth';
import { Link } from '@/i18n/navigation';
import { gsap } from '@/lib/gsap';
import { DURATION, EASE, DISTANCE, STAGGER_TOTAL_MAX } from '@/lib/motion-tokens';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { useAppSettings } from '@/components/providers/settings-provider';
import {
  deleteRow,
  fetchRows,
  listFields,
  searchableFields,
  type ResourceListResult,
  type ResourceRow,
  type ResourceSchema,
} from '@/lib/resource-api';

/**
 * One table for every resource, rendered from its schema.
 *
 * Search, filter, sort and pagination all go to the SERVER. Filtering an array
 * in the browser works at 40 rows and ships thousands to a phone at scale — and
 * the engine already validates every sort and filter key against the config, so
 * doing it client-side would also bypass that.
 *
 * Columns come from `inList` fields; each cell is rendered by semantic type in
 * ResourceCell. Adding a resource adds no code here.
 */

const ALL = 'all';

interface ResourceTableProps {
  schema: ResourceSchema;
}

export function ResourceTable({ schema }: ResourceTableProps) {
  const t = useTranslations('resource');
  const tAudit = useTranslations('audit');
  const tTable = useTranslations('table');
  const translateError = useTranslatedApiError();
  const { tablePageSize } = useAppSettings();
  const { user } = useAuth();
  // Same gate as the audit route itself (requireArea('staff')) — showing the
  // link to someone who cannot open the page would be a courtesy that 403s.
  const canViewHistory = canAccessArea((user?.role ?? 'DEMO') as StaffRole, 'staff');

  const [result, setResult] = useState<ResourceListResult | null>(null);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [formRow, setFormRow] = useState<ResourceRow | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Mirrors assertPermitted() in resource.service.ts, which is DEFAULT-DENY:
  // only an explicit `true` grants the action. Reading it any looser would
  // render buttons that always come back 403.
  const canCreate = schema.permissions.create === true;
  const canUpdate = schema.permissions.update === true;
  const canDelete = schema.permissions.delete === true;

  const container = useRef<HTMLDivElement>(null);

  /** The row's human name, for action labels and delete confirmations. */
  const rowLabel = (row: ResourceRow): string => {
    const value = row[schema.labelField];
    return value === null || value === undefined ? String(row.id) : String(value);
  };

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const active = Object.fromEntries(
        Object.entries(filters).filter(([, value]) => value !== ALL && value !== ''),
      );

      setResult(
        await fetchRows(schema.resource, {
          page,
          pageSize: tablePageSize,
          ...(search ? { search } : {}),
          filters: active,
        }),
      );
    } catch (caught) {
      setError(translateError(caught));
      setResult(null);
    } finally {
      setIsLoading(false);
    }
  }, [schema.resource, page, search, filters, tablePageSize, translateError]);

  useEffect(() => {
    void load();
  }, [load]);

  // Debounced so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchInput]);

  // Reset everything when the resource changes — carrying a product's filters
  // onto the customers table would silently produce an error or empty page.
  useEffect(() => {
    setPage(1);
    setSearchInput('');
    setSearch('');
    setFilters({});
    setSelectedIds(new Set());
  }, [schema.resource]);

  /**
   * Deletion reports what the SERVER actually did.
   *
   * A resource hook may archive instead of deleting — a product that appears
   * in a past order is archived, because a hard delete would blank the line
   * item and silently rewrite someone's order history. The API says which
   * happened in `action`, so claiming "deleted" for all of them would be the
   * UI lying about a decision it didn't make.
   *
   * `allSettled`, not `all`: one row failing must not hide the fact that the
   * other four succeeded, and the table has to reload either way.
   */
  async function runDelete(ids: string[]) {
    setIsDeleting(true);

    const outcomes = await Promise.allSettled(
      ids.map(async (id) => (await deleteRow(schema.resource, id)).action),
    );

    const count = (action: 'deleted' | 'archived') =>
      outcomes.filter(
        (outcome) => outcome.status === 'fulfilled' && outcome.value === action,
      ).length;

    const deleted = count('deleted');
    const archived = count('archived');
    const failed = outcomes.filter((outcome) => outcome.status === 'rejected');

    const parts: string[] = [];
    if (deleted > 0) parts.push(t('notice.deleted', { count: deleted }));
    if (archived > 0) parts.push(t('notice.archived', { count: archived }));

    if (failed.length > 0) {
      toast.error([...parts, translateError(failed[0]?.reason)].join(' '));
    } else {
      toast.success(parts.join(' '));
    }

    // Removing the last row on a page would otherwise leave the user staring
    // at an empty table with pagination still claiming the page exists.
    const removed = deleted + archived;
    const wasWholePage = removed >= (result?.rows.length ?? 0);

    setIsDeleting(false);
    setPendingDelete(null);
    setSelectedIds(new Set());

    if (wasWholePage && page > 1) {
      setPage((current) => current - 1);
    } else {
      await load();
    }
  }

  /**
   * Rows arrive in a batch, so they enter as one — staggered in reading order
   * rather than all at once, which reads as a flash.
   *
   * `amount` rather than `each`: with `each`, 20 rows at 0.04s is comfortable
   * and 100 rows is four seconds of waiting. `amount` spreads a FIXED total
   * across however many rows there are.
   */
  useGSAP(
    () => {
      if (isLoading || !result?.rows.length) return;

      const media = gsap.matchMedia();

      media.add(
        {
          motion: '(prefers-reduced-motion: no-preference)',
          reduced: '(prefers-reduced-motion: reduce)',
        },
        (context) => {
          const { motion } = context.conditions as { motion: boolean };

          gsap.from('tbody tr', {
            opacity: 0,
            y: motion ? DISTANCE.sm : 0,
            duration: motion ? DURATION.fast : DURATION.instant,
            ease: EASE.out,
            stagger: motion ? { amount: STAGGER_TOTAL_MAX } : 0,
            // Cleared so a row animating in cannot leave a stale transform
            // behind, which would offset a sticky header on scroll.
            clearProps: 'transform',
          });
        },
      );

      return () => media.revert();
    },
    { scope: container, dependencies: [result, isLoading] },
  );

  const dataColumns: Column<ResourceRow>[] = listFields(schema).map((field) => ({
    id: field.name,
    header: field.label,
    // Numeric values are end-aligned so digits line up column-wise.
    align: field.type === 'money' || field.type === 'number' ? 'end' : 'start',
    cell: (row) => (
      <ResourceCell field={field} row={row} resource={schema.resource} />
    ),
    // Only fields the SERVER will sort by are made sortable, so the control
    // never offers something that returns a 400.
    ...(field.sortable
      ? {
          sortValue: (row: ResourceRow) => {
            const value = row[field.name];
            if (value === null || value === undefined) return null;
            if (field.type === 'money' || field.type === 'number') return Number(value);
            return String(value);
          },
        }
      : {}),
  }));

  /**
   * Row actions live in a trailing column rather than a hover-only affordance:
   * hover targets are invisible to touch and to keyboard users, and this table
   * is the primary way every resource gets edited.
   */
  const columns: readonly Column<ResourceRow>[] =
    canUpdate || canDelete || canViewHistory
      ? [
          ...dataColumns,
          {
            id: '__actions',
            header: <span className="sr-only">{t('actions.label')}</span>,
            align: 'end',
            cell: (row) => (
              <div className="flex justify-end gap-1">
                {canUpdate ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setFormRow(row);
                          setIsFormOpen(true);
                        }}
                        // The row has no visible label of its own, so the button
                        // names what it acts on for screen readers.
                        aria-label={t('actions.editRow', { label: rowLabel(row) })}
                      >
                        <Pencil aria-hidden />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('actions.editRow', { label: rowLabel(row) })}</TooltipContent>
                  </Tooltip>
                ) : null}
                {canDelete ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setPendingDelete([String(row.id)])}
                        aria-label={t('actions.deleteRow', { label: rowLabel(row) })}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('actions.deleteRow', { label: rowLabel(row) })}</TooltipContent>
                  </Tooltip>
                ) : null}
                {canViewHistory ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" asChild>
                        <Link
                          href={`/admin/audit?entity=${schema.resource}&entityId=${String(row.id)}`}
                          aria-label={tAudit('viewHistory')}
                        >
                          <History aria-hidden />
                        </Link>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{tAudit('viewHistory')}</TooltipContent>
                  </Tooltip>
                ) : null}
              </div>
            ),
          },
        ]
      : dataColumns;

  const enumFilters = schema.fields.filter(
    (field) => field.type === 'enum' && field.options?.length,
  );

  const canSearch = searchableFields(schema).length > 0;

  return (
    <div ref={container} className="space-y-4">
      {canCreate ? (
        <div className="flex justify-end">
          <Button
            onClick={() => {
              setFormRow(null);
              setIsFormOpen(true);
            }}
          >
            {/* A plus is symmetric — never .icon-directional. */}
            <Plus aria-hidden />
            {t('actions.create', { label: schema.label })}
          </Button>
        </div>
      ) : null}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('confirmDelete.title', { count: pendingDelete?.length ?? 0 })}
            </AlertDialogTitle>
            {/* States the archive rule UP FRONT. Finding out after the fact
                that a "delete" only archived is a worse surprise than being
                told the rule before confirming. */}
            <AlertDialogDescription>
              {t('confirmDelete.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              {t('confirmDelete.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(event) => {
                // The action would otherwise close the dialog before the
                // delete finishes — this dialog stays open (and disabled)
                // until runDelete's own finally clears pendingDelete.
                event.preventDefault();
                if (pendingDelete) void runDelete(pendingDelete);
              }}
            >
              {isDeleting ? t('confirmDelete.working') : t('confirmDelete.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {canSearch || enumFilters.length > 0 ? (
        <div className="flex flex-wrap items-end gap-3">
          {canSearch ? (
            <div className="min-w-56 flex-1 space-y-2">
              <Label htmlFor="resource-search">{t('search.label')}</Label>
              {/* Suggestions reuse the SAME debounced result the table below
                  renders from — no second request. Open only once that
                  result actually reflects the typed query (not a stale
                  fetch from before the debounce caught up), so a suggestion
                  can never point at a row that no longer matches. */}
              <Popover open={canUpdate && searchFocused && searchInput.trim() !== '' && search === searchInput.trim() && (result?.rows.length ?? 0) > 0}>
                <PopoverAnchor asChild>
                  <div className="relative">
                    <Search
                      className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
                      aria-hidden
                    />
                    <Input
                      id="resource-search"
                      value={searchInput}
                      onChange={(event) => setSearchInput(event.target.value)}
                      onFocus={() => setSearchFocused(true)}
                      onBlur={() => setSearchFocused(false)}
                      // Names the actual columns searched, so nobody wonders why a
                      // description match returns nothing.
                      placeholder={t('search.placeholder', {
                        fields: searchableFields(schema)
                          .map((field) => field.label)
                          .join(', '),
                      })}
                      className="ps-9"
                      autoComplete="off"
                    />
                  </div>
                </PopoverAnchor>

                <PopoverContent
                  align="start"
                  className="w-72 p-1"
                  onOpenAutoFocus={(event) => event.preventDefault()}
                >
                  <ul>
                    {(result?.rows ?? []).slice(0, 5).map((row) => (
                      <li key={String(row.id)}>
                        <button
                          type="button"
                          // mousedown, not click: fires before the input's
                          // onBlur closes the popover, so the click lands.
                          onMouseDown={(event) => {
                            event.preventDefault();
                            setFormRow(row);
                            setIsFormOpen(true);
                          }}
                          className="hover:bg-muted flex w-full flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-start text-sm"
                        >
                          <span className="truncate font-medium">{rowLabel(row)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </PopoverContent>
              </Popover>
            </div>
          ) : null}

          {enumFilters.map((field) => (
            <div key={field.name} className="w-44 space-y-2">
              <Label htmlFor={`filter-${field.name}`}>{field.label}</Label>
              <Select
                value={filters[field.name] ?? ALL}
                onValueChange={(value) => {
                  setFilters((current) => ({ ...current, [field.name]: value }));
                  setPage(1);
                }}
              >
                <SelectTrigger id={`filter-${field.name}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t('filters.all')}</SelectItem>
                  {field.options?.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      ) : null}

      <DataTable
        data={result?.rows ?? []}
        columns={columns}
        getRowId={(row) => String(row.id)}
        isLoading={isLoading}
        error={error}
        onRetry={() => void load()}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        emptyMessage={
          search || Object.keys(filters).length > 0 ? (
            tTable('noResults')
          ) : (
            <EmptyState
              title={t('empty', { label: schema.label })}
              action={
                canCreate
                  ? {
                      label: t('actions.create', { label: schema.label }),
                      onClick: () => {
                        setFormRow(null);
                        setIsFormOpen(true);
                      },
                    }
                  : undefined
              }
            />
          )
        }
        // Selection existed before this with nothing attached to it — rows
        // could be ticked and no action was ever offered.
        bulkActions={
          canDelete
            ? (ids) => (
                <div className="flex items-center gap-3">
                  <span className="text-sm">{t('selected', { count: ids.size })}</span>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={isDeleting}
                    onClick={() => setPendingDelete([...ids])}
                  >
                    <Trash2 aria-hidden />
                    {t('actions.deleteSelected')}
                  </Button>
                </div>
              )
            : undefined
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

      {canCreate || canUpdate ? (
        <ResourceForm
          schema={schema}
          row={formRow}
          open={isFormOpen}
          onOpenChange={setIsFormOpen}
          onSaved={(action) => {
            toast.success(t(`notice.${action}`));
            void load();
          }}
        />
      ) : null}
    </div>
  );
}
