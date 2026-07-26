'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useGSAP } from '@gsap/react';
import { Search } from 'lucide-react';

import { DataTable, type Column } from '@/components/data-table';
import { ResourceCell } from '@/components/resource/resource-cell';
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
import { gsap } from '@/lib/gsap';
import { DURATION, EASE, DISTANCE, STAGGER_TOTAL_MAX } from '@/lib/motion-tokens';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import {
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
const PAGE_SIZE = 20;

interface ResourceTableProps {
  schema: ResourceSchema;
}

export function ResourceTable({ schema }: ResourceTableProps) {
  const t = useTranslations('resource');
  const tTable = useTranslations('table');
  const translateError = useTranslatedApiError();

  const [result, setResult] = useState<ResourceListResult | null>(null);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const container = useRef<HTMLDivElement>(null);

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
          pageSize: PAGE_SIZE,
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
  }, [schema.resource, page, search, filters, translateError]);

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

  const columns: readonly Column<ResourceRow>[] = listFields(schema).map((field) => ({
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

  const enumFilters = schema.fields.filter(
    (field) => field.type === 'enum' && field.options?.length,
  );

  const canSearch = searchableFields(schema).length > 0;

  return (
    <div ref={container} className="space-y-4">
      {canSearch || enumFilters.length > 0 ? (
        <div className="flex flex-wrap items-end gap-3">
          {canSearch ? (
            <div className="min-w-56 flex-1 space-y-2">
              <Label htmlFor="resource-search">{t('search.label')}</Label>
              <div className="relative">
                <Search
                  className="text-muted-foreground pointer-events-none absolute inset-inline-start-3 top-1/2 size-4 -translate-y-1/2"
                  aria-hidden
                />
                <Input
                  id="resource-search"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  // Names the actual columns searched, so nobody wonders why a
                  // description match returns nothing.
                  placeholder={t('search.placeholder', {
                    fields: searchableFields(schema)
                      .map((field) => field.label)
                      .join(', '),
                  })}
                  className="ps-9"
                />
              </div>
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
          search || Object.keys(filters).length > 0
            ? tTable('noResults')
            : t('empty', { label: schema.label })
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
    </div>
  );
}
