'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useGSAP } from '@gsap/react';
import { FilterX, History, Pencil, Plus, Search, SearchX, Trash2, Upload } from 'lucide-react';
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
import { DataTable, type Column, type SortState } from '@/components/data-table';
import { ColumnManager } from '@/components/column-manager';
import { DensityToggle } from '@/components/density-toggle';
import { EmptyState } from '@/components/empty-state';
import { FilterChips, type AppliedFilter } from '@/components/filter-chips';
import { RowActions, type RowAction } from '@/components/row-actions';
import { TablePagination } from '@/components/table-pagination';
import { ImportResourceSheet } from '@/components/resource/import-resource-sheet';
import { ResourceCell } from '@/components/resource/resource-cell';
import { ResourceForm } from '@/components/resource/resource-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { canAccessArea, type StaffRole } from '@/config/areas';
import { useAuth } from '@/hooks/useAuth';
import { useUrlState } from '@/hooks/useUrlState';
import { useTableDensity } from '@/hooks/useTableDensity';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { gsap } from '@/lib/gsap';
import { DURATION, EASE, DISTANCE, STAGGER_TOTAL_MAX } from '@/lib/motion-tokens';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { useAppSettings } from '@/components/providers/settings-provider';
import { getGlobalDensity } from '@/lib/apply-appearance';
import {
  deleteRow,
  fetchRelationOptions,
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

/**
 * Namespace for filter params.
 *
 * Without it, a resource with an enum field named `page` or `search` would
 * quietly overwrite the pagination controls — `admin.config.ts` is
 * user-editable, so a collision is a configuration away, not a hypothetical.
 */
const FILTER_PREFIX = 'f_';

/** Defaults are omitted from the URL, so the unfiltered view has a clean one. */
const URL_DEFAULTS = { page: '1', search: '', sort: '', dir: 'asc', pageSize: '' };

interface ResourceTableProps {
  schema: ResourceSchema;
}


export function ResourceTable({ schema }: ResourceTableProps) {
  const t = useTranslations('resource');
  const tAudit = useTranslations('audit');
  const tTable = useTranslations('table');
  const translateError = useTranslatedApiError();
  const { tablePageSize } = useAppSettings();

  /**
   * Per-table density, overriding `ui.density` for just this table — see
   * useTableDensity.ts. `override` is null until the user picks one, in
   * which case DataTable is left to inherit the global `[data-density]`
   * value the same way it always has.
   */
  const { override: densityOverride, setOverride: setDensityOverride } =
    useTableDensity(`resource:${schema.resource}`);

  /** Per-table column show/hide — see useColumnVisibility.ts. */
  const { hiddenColumns, toggle: toggleColumn, reset: resetColumns } = useColumnVisibility(
    `resource:${schema.resource}`,
  );
  const { user } = useAuth();
  // Same gate as the audit route itself (requireArea('staff')) — showing the
  // link to someone who cannot open the page would be a courtesy that 403s.
  const canViewHistory = canAccessArea((user?.role ?? 'DEMO') as StaffRole, 'staff');

  const [result, setResult] = useState<ResourceListResult | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Options for `relation`-type filter dropdowns, keyed by field name.
   *
   * Loaded once per resource (no search box on a FILTER dropdown — unlike the
   * form's relation picker, which searches as the target list can be large,
   * a filter only needs "which values actually occur", so the plain
   * unfiltered option list is enough here).
   */
  const [relationFilterOptions, setRelationFilterOptions] = useState<
    Record<string, { value: string; label: string }[]>
  >({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  /**
   * Page, search and filters live in the URL, not in component state.
   *
   * This table renders six different resources, so the fix lands on products,
   * customers, categories, discounts, reviews and notifications at once. The
   * requirement it satisfies: paste the URL and a colleague sees the same
   * screen, and back steps through the filters you applied.
   *
   * Filter keys are namespaced `f_<field>` so an enum field called `page` or
   * `search` can never collide with the reserved controls.
   */
  const { values, setValues, clear } = useUrlState(URL_DEFAULTS);

  const page = Math.max(1, Number(values.page) || 1);
  const search = values.search ?? '';

  /**
   * Overrides `dashboard.tablePageSize` for THIS view only.
   *
   * The store-wide setting stays the default; a value in the URL is a
   * temporary "show me more rows" for the current list, shareable and gone on
   * the next visit rather than a round-trip through Settings.
   */
  const urlPageSize = Number(values.pageSize);
  const effectivePageSize =
    Number.isFinite(urlPageSize) && urlPageSize > 0 ? urlPageSize : tablePageSize;

  const filters = useMemo(() => {
    const active: Record<string, string> = {};
    for (const [key, value] of Object.entries(values)) {
      if (!key.startsWith(FILTER_PREFIX) || !value || value === ALL) continue;

      const name = key.slice(FILTER_PREFIX.length);
      const field = schema.fields.find((candidate) => candidate.name === name);

      // A hand-edited URL naming an unknown field, or a boolean filter with
      // anything other than "true"/"false", degrades to "no filter" instead
      // of reaching the API — coerceFilterValue would 400 on either, and an
      // unfiltered list is a truthful recovery where an error page isn't.
      if (!field) continue;
      if (field.type === 'boolean' && value !== 'true' && value !== 'false') continue;

      active[name] = value;
    }
    return active;
  }, [values, schema.fields]);

  /**
   * The search box is uncontrolled-ish: it holds the raw keystrokes locally
   * and only writes to the URL after the debounce. Driving the input straight
   * from the URL would navigate on every character.
   *
   * Seeded from the URL so a shared link populates the box, and re-seeded when
   * the resource changes (the effect below), never on every URL change — that
   * would fight the user's own typing.
   */
  const [searchInput, setSearchInput] = useState(search);

  /**
   * Drives the filtered-vs-first-run empty state and the Clear-all control.
   * Page is deliberately excluded: being on page 3 is not a filter, and an
   * empty page 3 is a pagination problem, not "no results".
   */
  const hasActiveFilters = search !== '' || Object.keys(filters).length > 0;

  const clearFilters = useCallback(() => {
    setSearchInput('');
    clear([
      'search',
      'page',
      ...Object.keys(filters).map((name) => `${FILTER_PREFIX}${name}`),
    ]);
  }, [clear, filters]);

  /**
   * Sort in the URL, as `?sort=name&dir=desc`.
   *
   * Validated against the schema's sortable fields rather than trusted: a
   * hand-edited or stale `?sort=` naming a column that no longer exists would
   * otherwise leave the header showing an active sort for a field the table
   * can't sort by.
   */
  const sortField = values.sort ?? '';
  const sortIsValid = listFields(schema).some(
    (field) => field.name === sortField && field.sortable,
  );

  const sort: SortState | null = sortIsValid
    ? { id: sortField, direction: values.dir === 'desc' ? 'desc' : 'asc' }
    : null;

  const handleSortChange = useCallback(
    (next: SortState | null) => {
      setValues({
        sort: next?.id ?? null,
        // Only `desc` is written — `asc` is the default, so omitting it keeps
        // the common case's URL short.
        dir: next?.direction === 'desc' ? 'desc' : null,
      });
    },
    [setValues],
  );

  /** Built from the same values the query uses, so a chip can never claim a
   *  filter that isn't actually applied. */
  const appliedFilters: AppliedFilter[] = [
    ...(search
      ? [
          {
            id: 'search',
            label: `${t('search.label')}: ${search}`,
            onRemove: () => {
              setSearchInput('');
              setValues({ search: null, page: null });
            },
          },
        ]
      : []),
    ...Object.entries(filters).map(([name, value]) => {
      const field = schema.fields.find((candidate) => candidate.name === name);
      // Chip text should read like the option the user picked, not the raw
      // wire value — "true"/"false" and a bare relation id both mean nothing
      // to whoever glances at the chip row.
      const displayValue =
        field?.type === 'boolean'
          ? t(value === 'true' ? 'yes' : 'no')
          : field?.type === 'relation'
            ? (relationFilterOptions[name]?.find((option) => option.value === value)?.label ??
              value)
            : value;
      return {
        id: name,
        label: `${field?.label ?? name}: ${displayValue}`,
        onRemove: () =>
          setValues({ [`${FILTER_PREFIX}${name}`]: null, page: null }),
      };
    }),
  ];

  const [formRow, setFormRow] = useState<ResourceRow | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
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
          pageSize: effectivePageSize,
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
  }, [schema.resource, page, search, filters, effectivePageSize, translateError]);

  /**
   * Walks every page matching the CURRENT filter and returns every row id.
   *
   * Capped, not unbounded — the backend clamps a single page to 100 rows
   * (`MAX_PAGE_SIZE`), so "select all 4,000 matching rows" would otherwise
   * mean 40 sequential requests before the user's click resolves. The cap is
   * generous for an admin back office's real scale (hundreds, rarely
   * thousands, of rows per resource) and — critically — the caller is told
   * explicitly when it's hit rather than silently handed a truncated
   * selection that LOOKS like everything.
   */
  const MAX_SELECT_ALL = 2000;

  const fetchAllMatchingIds = useCallback(async (): Promise<string[]> => {
    const active = Object.fromEntries(
      Object.entries(filters).filter(([, value]) => value !== ALL && value !== ''),
    );

    const ids: string[] = [];
    let currentPage = 1;
    // The server's own max — walking the fewest possible requests to reach
    // MAX_SELECT_ALL.
    const walkPageSize = 100;

    for (;;) {
      const chunk = await fetchRows(schema.resource, {
        page: currentPage,
        pageSize: walkPageSize,
        ...(search ? { search } : {}),
        filters: active,
      });

      // Checked against the SERVER'S total, not against how many ids have
      // been collected so far. A total of exactly 2000 sitting right at the
      // cap must succeed — collected-so-far reaching 2000 while more still
      // remains beyond it must refuse. Comparing `ids.length` to itself would
      // conflate "exactly at the cap, nothing more" with "over the cap,
      // truncated here", and silently return a partial set as if complete.
      if (chunk.total > MAX_SELECT_ALL) {
        throw new Error(tTable('selectAllMatching.tooMany', { max: MAX_SELECT_ALL }));
      }

      for (const row of chunk.rows) ids.push(String(row.id));

      if (currentPage >= chunk.totalPages) break;
      currentPage += 1;
    }

    return ids;
  }, [schema.resource, search, filters, tTable]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Debounced so typing doesn't fire a request — or a navigation — per
   * keystroke. Writing search and page together in ONE call matters: two
   * separate writes would each read the same `searchParams` snapshot and the
   * second would clobber the first, leaving the user on page 4 of a new query.
   */
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === search) return;

    const timer = setTimeout(() => {
      setValues({ search: trimmed, page: null });
    }, 300);

    return () => clearTimeout(timer);
  }, [searchInput, search, setValues]);

  /**
   * Reset when the resource CHANGES — carrying a product's filters onto the
   * customers table would silently produce an error or an empty page.
   *
   * Guarded against firing on mount. A plain `[schema.resource]` effect runs
   * once on first render too, which would blank the search box on arrival and
   * throw away a deep-linked `?search=` before the user ever saw it.
   *
   * Only the local input is reset. The URL params belong to the route being
   * left, and Next.js gives the new route its own query string, so clearing
   * them here would fight a legitimate inbound link.
   */
  const previousResource = useRef(schema.resource);

  useEffect(() => {
    if (previousResource.current === schema.resource) return;
    previousResource.current = schema.resource;

    setSearchInput('');
    setSelectedIds(new Set());
  }, [schema.resource]);

  /**
   * Loads the option list for every `relation` filter once per resource.
   *
   * A field silently keeps its stale options if the fetch fails — a filter
   * dropdown with no choices is a worse failure than one showing last
   * resource's options for the instant before a retry, and the field is not
   * load-bearing enough to justify an error state of its own.
   */
  useEffect(() => {
    const relationFields = schema.fields.filter((field) => field.type === 'relation');
    if (relationFields.length === 0) return;

    let cancelled = false;

    void Promise.all(
      relationFields.map(async (field) => {
        const options = await fetchRelationOptions(schema.resource, field.name).catch(() => null);
        return [field.name, options] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      setRelationFilterOptions((previous) => {
        const next = { ...previous };
        for (const [name, options] of entries) {
          if (options) next[name] = options;
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [schema.resource, schema.fields]);

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
      // Stepping back changes the URL, which re-runs `load` via the effect.
      setValues({ page: String(page - 1) });
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

  const allDataColumns: Column<ResourceRow>[] = listFields(schema).map((field) => ({
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

  // A column hidden via the manager is dropped from render entirely, not
  // just visually hidden — an unrendered ResourceCell can't fire the extra
  // request some field types (relations) make to resolve their display value.
  const dataColumns = allDataColumns.filter((column) => !hiddenColumns.has(column.id));

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
            cell: (row) => {
              // Edit and Delete visible (the two a staff member reaches for
              // most), history behind the overflow — but the split is
              // RowActions' call, not hand-tuned per row.
              const actions: RowAction[] = [
                ...(canUpdate
                  ? [
                      {
                        id: 'edit',
                        label: t('actions.editRow', { label: rowLabel(row) }),
                        icon: Pencil,
                        onClick: () => {
                          setFormRow(row);
                          setIsFormOpen(true);
                        },
                      },
                    ]
                  : []),
                ...(canDelete
                  ? [
                      {
                        id: 'delete',
                        label: t('actions.deleteRow', { label: rowLabel(row) }),
                        icon: Trash2,
                        variant: 'destructive' as const,
                        onClick: () => setPendingDelete([String(row.id)]),
                      },
                    ]
                  : []),
                ...(canViewHistory
                  ? [
                      {
                        id: 'history',
                        label: tAudit('viewHistory'),
                        icon: History,
                        href: `/admin/audit?entity=${schema.resource}&entityId=${String(row.id)}`,
                      },
                    ]
                  : []),
              ];

              return <RowActions actions={actions} />;
            },
          },
        ]
      : dataColumns;

  const enumFilters = schema.fields.filter(
    (field) => field.type === 'enum' && field.options?.length,
  );

  /**
   * Boolean and relation fields get their own dropdown, same `f_<field>`
   * mechanism as enum filters — both are EXACT-match on the backend
   * (`coerceFilterValue` in resource.service.ts), so a `Select` is a truthful
   * UI for them. Number/money/date/datetime are deliberately NOT included
   * here: the backend has no range-comparison support today, and an
   * exact-match filter on a price or timestamp would be nearly useless — that
   * needs its own backend work first, not a UI-only pass.
   */
  const booleanFilters = schema.fields.filter((field) => field.type === 'boolean');
  const relationFilters = schema.fields.filter(
    (field) => field.type === 'relation' && relationFilterOptions[field.name]?.length,
  );

  const canSearch = searchableFields(schema).length > 0;
  const hasFilterControls =
    enumFilters.length > 0 || booleanFilters.length > 0 || relationFilters.length > 0;

  return (
    <div ref={container} className="space-y-4">
      {canCreate ? (
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setIsImportOpen(true)}>
            <Upload aria-hidden />
            {t('actions.import')}
          </Button>
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

      <ImportResourceSheet
        resource={schema.resource}
        resourceLabel={schema.label}
        open={isImportOpen}
        onOpenChange={setIsImportOpen}
        onImported={() => void load()}
      />

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

      {canSearch || hasFilterControls ? (
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
                  // Filter + page reset in one write, for the same
                  // clobbering reason as the debounced search above.
                  setValues({
                    [`${FILTER_PREFIX}${field.name}`]: value === ALL ? null : value,
                    page: null,
                  });
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

          {booleanFilters.map((field) => (
            <div key={field.name} className="w-44 space-y-2">
              <Label htmlFor={`filter-${field.name}`}>{field.label}</Label>
              <Select
                value={filters[field.name] ?? ALL}
                onValueChange={(value) => {
                  setValues({
                    [`${FILTER_PREFIX}${field.name}`]: value === ALL ? null : value,
                    page: null,
                  });
                }}
              >
                <SelectTrigger id={`filter-${field.name}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t('filters.all')}</SelectItem>
                  <SelectItem value="true">{t('yes')}</SelectItem>
                  <SelectItem value="false">{t('no')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ))}

          {relationFilters.map((field) => (
            <div key={field.name} className="w-44 space-y-2">
              <Label htmlFor={`filter-${field.name}`}>{field.label}</Label>
              <Select
                value={filters[field.name] ?? ALL}
                onValueChange={(value) => {
                  setValues({
                    [`${FILTER_PREFIX}${field.name}`]: value === ALL ? null : value,
                    page: null,
                  });
                }}
              >
                <SelectTrigger id={`filter-${field.name}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>{t('filters.all')}</SelectItem>
                  {relationFilterOptions[field.name]?.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <FilterChips filters={appliedFilters} onClearAll={clearFilters} />
        <div className="ms-auto flex shrink-0 items-center gap-2">
          <ColumnManager
            columns={allDataColumns.map((column) => ({
              id: column.id,
              // `header` is a plain string for every generated column here
              // (see `listFields` above) — never the sort-button JSX the
              // desktop table renders it as, so this cast is safe rather
              // than approximate.
              label: String(column.header),
            }))}
            hiddenColumns={hiddenColumns}
            onToggle={toggleColumn}
            onReset={resetColumns}
          />
          <DensityToggle
            value={densityOverride ?? getGlobalDensity()}
            onChange={setDensityOverride}
          />
        </div>
      </div>

      <DataTable
        data={result?.rows ?? []}
        columns={columns}
        getRowId={(row) => String(row.id)}
        isLoading={isLoading}
        error={error}
        onRetry={() => void load()}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        density={densityOverride ?? undefined}
        sort={sort}
        onSortChange={handleSortChange}
        selectAllMatching={
          result
            ? { totalMatching: result.total, fetchAllIds: fetchAllMatchingIds }
            : undefined
        }
        /**
         * Two genuinely different empty states.
         *
         * "Nothing exists yet" invites you to create the first row. "Nothing
         * matched" must NOT — the rows are there, the filter is hiding them,
         * and offering "create" as the only way out is how a user ends up with
         * a duplicate record they didn't need. The filtered case gets its own
         * copy and a way to undo the filter instead.
         */
        emptyMessage={
          hasActiveFilters ? (
            <EmptyState
              icon={SearchX}
              title={t('emptyFiltered', { label: schema.label })}
              description={t('emptyFilteredHint')}
              action={{
                label: t('actions.clearFilters'),
                onClick: clearFilters,
                icon: FilterX,
              }}
            />
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

      {result ? (
        <TablePagination
          page={page}
          totalPages={result.totalPages}
          total={result.total}
          pageSize={effectivePageSize}
          isLoading={isLoading}
          onPageChange={(next) => setValues({ page: String(next) })}
          onPageSizeChange={(next) =>
            // Changing the size mid-scroll and staying on a page that no
            // longer exists would show an empty table with the count still
            // claiming rows — resetting to 1 keeps the result honest.
            setValues({ pageSize: String(next), page: null })
          }
          totalLabel={t('total', { count: result.total })}
        />
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
