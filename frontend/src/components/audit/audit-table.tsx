'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';

import { DataTable, type Column } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { DatePicker } from '@/components/ui/date-picker';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { useAppSettings } from '@/components/providers/settings-provider';
import {
  fetchAudit,
  fetchAuditEntities,
  type AuditEntry,
  type AuditListResult,
} from '@/lib/audit-api';
import { fetchStaff, type StaffMember } from '@/lib/staff-api';

/**
 * Read-only viewer for the audit trail (`/api/v1/audit`).
 *
 * There is deliberately no write path anywhere near this component — see
 * audit.route.ts. Every filter here narrows a GET; nothing here can create,
 * edit or delete a row.
 */

const ALL = 'all';

/** One line per changed field: "price: 19.99 → 24.99". */
function formatChanges(changes: AuditEntry['changes']): string[] {
  if (!changes) return [];

  return Object.entries(changes).map(([field, change]) => {
    const from = change && typeof change === 'object' ? change.from : undefined;
    const to = change && typeof change === 'object' ? change.to : undefined;
    return `${field}: ${formatValue(from)} → ${formatValue(to)}`;
  });
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '∅';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function AuditTable() {
  const t = useTranslations('audit');
  const tTable = useTranslations('table');
  const translateError = useTranslatedApiError();
  const { tablePageSize } = useAppSettings();
  const formatter = useFormatter();
  const searchParams = useSearchParams();

  // Seeded once from the URL — a "view history" link from a resource row
  // arrives as `?entity=products&entityId=123`. Read with a lazy initializer
  // rather than an effect, so the very first render already shows the
  // scoped record instead of flashing "all entities" for a frame.
  const [result, setResult] = useState<AuditListResult | null>(null);
  const [page, setPage] = useState(1);
  const [entity, setEntity] = useState<string>(() => searchParams.get('entity') ?? ALL);
  const [entityId, setEntityId] = useState<string>(() => searchParams.get('entityId') ?? '');
  const [actorId, setActorId] = useState<string>(ALL);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [entities, setEntities] = useState<string[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);

  useEffect(() => {
    fetchAuditEntities()
      .then(setEntities)
      // A failed dropdown source must not take the whole page down — the
      // filter just renders with no options beyond "All".
      .catch(() => setEntities([]));

    fetchStaff({ pageSize: 100 })
      .then((loaded) => setStaff(loaded.staff))
      .catch(() => setStaff([]));
  }, []);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      setResult(
        await fetchAudit({
          page,
          pageSize: tablePageSize,
          ...(entity !== ALL ? { entity } : {}),
          ...(entityId ? { entityId } : {}),
          ...(actorId !== ALL ? { actorId } : {}),
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
        }),
      );
    } catch (caught) {
      setError(translateError(caught));
      setResult(null);
    } finally {
      setIsLoading(false);
    }
  }, [page, entity, entityId, actorId, from, to, tablePageSize, translateError]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: readonly Column<AuditEntry>[] = [
    {
      id: 'when',
      header: t('columns.when'),
      cell: (row) => (
        <span className="force-ltr text-sm tabular-nums">
          {formatter.dateTime(new Date(row.createdAt), 'short')}
        </span>
      ),
    },
    {
      id: 'actor',
      header: t('columns.actor'),
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-sm">{row.actorEmail ?? t('systemActor')}</p>
          {row.actorRole ? (
            <StatusBadge kind="roles" value={row.actorRole} className="mt-0.5" />
          ) : null}
        </div>
      ),
    },
    {
      id: 'action',
      header: t('columns.action'),
      cell: (row) => <code className="force-ltr text-xs">{row.action}</code>,
    },
    {
      id: 'entity',
      header: t('columns.entity'),
      cell: (row) => (
        <div className="min-w-0">
          <p className="text-sm">{row.entity}</p>
          {row.entityId ? (
            <p className="text-muted-foreground force-ltr truncate text-xs">
              {row.entityId}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      id: 'changes',
      header: t('columns.changes'),
      cell: (row) => {
        const lines = formatChanges(row.changes);
        if (lines.length === 0) {
          return <span className="text-muted-foreground text-sm">{t('noChanges')}</span>;
        }
        return (
          <ul className="space-y-0.5">
            {lines.map((line) => (
              <li key={line} className="text-xs">
                {line}
              </li>
            ))}
          </ul>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      {entityId ? (
        <div className="bg-muted flex items-center gap-2 rounded-md px-3 py-2 text-sm">
          <span>
            {t('filters.entity')}: {entity} · {entityId}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={t('filters.clear')}
            onClick={() => {
              setEntityId('');
              setPage(1);
            }}
          >
            <X aria-hidden />
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48 space-y-2">
          <Label htmlFor="audit-filter-entity">{t('filters.entity')}</Label>
          <Select
            value={entity}
            onValueChange={(value) => {
              setEntity(value);
              // A stale entityId scoped to the PREVIOUS entity would silently
              // filter to a combination that can never match.
              setEntityId('');
              setPage(1);
            }}
          >
            <SelectTrigger id="audit-filter-entity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('filters.all')}</SelectItem>
              {entities.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-56 space-y-2">
          <Label htmlFor="audit-filter-actor">{t('filters.actor')}</Label>
          <Select
            value={actorId}
            onValueChange={(value) => {
              setActorId(value);
              setPage(1);
            }}
          >
            <SelectTrigger id="audit-filter-actor">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('filters.all')}</SelectItem>
              {staff.map((member) => (
                <SelectItem key={member.id} value={member.id}>
                  {member.name ?? member.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-44 space-y-2">
          <Label htmlFor="audit-filter-from">{t('filters.from')}</Label>
          <DatePicker
            id="audit-filter-from"
            value={from}
            onChange={(value) => {
              setFrom(value);
              setPage(1);
            }}
          />
        </div>

        <div className="w-44 space-y-2">
          <Label htmlFor="audit-filter-to">{t('filters.to')}</Label>
          <DatePicker
            id="audit-filter-to"
            value={to}
            onChange={(value) => {
              setTo(value);
              setPage(1);
            }}
          />
        </div>

        {entity !== ALL || entityId || actorId !== ALL || from || to ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setEntity(ALL);
              setEntityId('');
              setActorId(ALL);
              setFrom('');
              setTo('');
              setPage(1);
            }}
          >
            {t('filters.clear')}
          </Button>
        ) : null}
      </div>

      <DataTable
        data={result?.entries ?? []}
        columns={columns}
        getRowId={(row) => row.id}
        isLoading={isLoading}
        error={error}
        onRetry={() => void load()}
        emptyMessage={t('empty')}
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
