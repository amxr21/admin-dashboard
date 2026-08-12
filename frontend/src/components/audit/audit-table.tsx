'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Download, Link2, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';

import { DataTable, type Column } from '@/components/data-table';
import { StatusBadge } from '@/components/status-badge';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
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
import { useUrlState } from '@/hooks/useUrlState';
import { useAppSettings } from '@/components/providers/settings-provider';
import {
  exportAuditCsv,
  fetchAudit,
  fetchAuditActions,
  fetchAuditEntities,
  type AuditEntry,
  type AuditListResult,
  type AuditOutcome,
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

/** Defaults are omitted from the URL, so an unfiltered log has a clean one. */
const URL_DEFAULTS = {
  page: '1',
  entity: ALL,
  entityId: '',
  actorId: ALL,
  action: ALL,
  outcome: ALL,
  requestId: '',
  from: '',
  to: '',
};

const OUTCOMES: readonly AuditOutcome[] = ['SUCCESS', 'DENIED', 'ERROR'];

/** Hand-edited URLs reach this component too — an unknown value must fall back
 * to "all" rather than travel to the API as an unactionable 400. */
function toOutcome(value: string): AuditOutcome | null {
  return (OUTCOMES as readonly string[]).includes(value) ? (value as AuditOutcome) : null;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '∅';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function AuditTable() {
  const t = useTranslations('audit');
  const tTable = useTranslations('table');
  const tOutcome = useTranslations('auditOutcome');
  const translateError = useTranslatedApiError();
  const { tablePageSize } = useAppSettings();
  const formatter = useFormatter();

  const [result, setResult] = useState<AuditListResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  /**
   * Every filter lives in the URL.
   *
   * This page is deep-linked into from two places — the "view history" icon on
   * every resource row and the returns detail sheet — via `?entity=&entityId=`.
   * Those were read once into state and never written back, so the moment a
   * user changed any filter the URL described a different screen than the one
   * they were looking at. Sharing that link sent a colleague somewhere else.
   */
  const { values, setValues } = useUrlState(URL_DEFAULTS);

  const page = Math.max(1, Number(values.page) || 1);
  const entity = values.entity ?? ALL;
  const entityId = values.entityId ?? '';
  const actorId = values.actorId ?? ALL;
  const action = values.action ?? ALL;
  const outcome = values.outcome ?? ALL;
  const requestId = values.requestId ?? '';
  const from = values.from ?? '';
  const to = values.to ?? '';
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const [entities, setEntities] = useState<string[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);

  useEffect(() => {
    fetchAuditEntities()
      .then(setEntities)
      // A failed dropdown source must not take the whole page down — the
      // filter just renders with no options beyond "All".
      .catch(() => setEntities([]));

    fetchAuditActions()
      .then(setActions)
      .catch(() => setActions([]));

    fetchStaff({ pageSize: 100 })
      .then((loaded) => setStaff(loaded.staff))
      .catch(() => setStaff([]));
  }, []);

  /**
   * The filter set, in one place.
   *
   * The table and the CSV export both read this, so an export can never
   * describe a different set of rows than the screen it was taken from.
   */
  const filters = useMemo(
    () => ({
      ...(entity !== ALL ? { entity } : {}),
      ...(entityId ? { entityId } : {}),
      ...(actorId !== ALL ? { actorId } : {}),
      ...(action !== ALL ? { action } : {}),
      ...(toOutcome(outcome) ? { outcome: toOutcome(outcome) as AuditOutcome } : {}),
      ...(requestId ? { requestId } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    }),
    [entity, entityId, actorId, action, outcome, requestId, from, to],
  );

  const hasFilters = Object.keys(filters).length > 0;

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      setResult(await fetchAudit({ page, pageSize: tablePageSize, ...filters }));
    } catch (caught) {
      setError(translateError(caught));
      setResult(null);
    } finally {
      setIsLoading(false);
    }
  }, [page, filters, tablePageSize, translateError]);

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      // Exports the FILTER, not the current page — a reviewer asking for "every
      // denial last month" means all of them, not the 50 currently on screen.
      await exportAuditCsv(filters);
    } catch (caught) {
      toast.error(translateError(caught));
    } finally {
      setIsExporting(false);
    }
  }, [filters, translateError]);

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
      cell: (row) => (
        <div className="min-w-0 space-y-1">
          <code className="force-ltr block text-xs">{row.action}</code>
          {row.outcome !== 'SUCCESS' ? (
            <StatusBadge kind="auditOutcome" value={row.outcome} />
          ) : null}
        </div>
      ),
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
        // A denial changed nothing by definition. Saying so plainly is more
        // useful than an empty cell that reads as missing data.
        if (row.outcome === 'DENIED' && !row.changes) {
          return <span className="text-muted-foreground text-sm">{t('deniedNotice')}</span>;
        }

        const fields = row.changes ? Object.entries(row.changes) : [];
        if (fields.length === 0) {
          return <span className="text-muted-foreground text-sm">{t('noChanges')}</span>;
        }

        return (
          <ul className="space-y-1">
            {fields.map(([field, change]) => {
              const from = change && typeof change === 'object' ? change.from : undefined;
              const to = change && typeof change === 'object' ? change.to : undefined;

              // Some entries record context rather than a before→after pair
              // (a denial's role/path, an export's row count). Rendering
              // "undefined → undefined" for those would be a lie.
              const isDiff =
                change !== null &&
                typeof change === 'object' &&
                ('from' in change || 'to' in change);

              return (
                <li key={field} className="text-xs">
                  <span className="text-muted-foreground">{field}: </span>
                  {isDiff ? (
                    <span className="force-ltr">
                      <span className="text-destructive line-through">
                        {formatValue(from)}
                      </span>
                      {' → '}
                      <span className="text-success font-medium">{formatValue(to)}</span>
                    </span>
                  ) : (
                    <span className="force-ltr">{formatValue(change)}</span>
                  )}
                </li>
              );
            })}
          </ul>
        );
      },
    },
    {
      id: 'source',
      header: t('columns.source'),
      cell: (row) => (
        <div className="min-w-0 space-y-0.5">
          {row.ip ? (
            <p className="force-ltr text-muted-foreground text-xs">{row.ip}</p>
          ) : null}
          {row.userAgent ? (
            <p
              className="text-muted-foreground max-w-[16rem] truncate text-xs"
              title={row.userAgent}
            >
              {row.userAgent}
            </p>
          ) : null}
          {row.requestId ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground h-auto px-1 py-0 text-xs"
              // Correlation (B1.5): everything written by one request, so a
              // single action's full set of effects reads together.
              onClick={() => setValues({ requestId: row.requestId, page: null })}
              title={t('sameRequest')}
            >
              <Link2 aria-hidden className="me-1 size-3" />
              <span className="force-ltr truncate">{row.requestId.slice(0, 8)}</span>
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/**
       * B1.3 — say what this log IS.
       *
       * The read-only guarantee is the whole reason the trail is evidence, and
       * it was invisible: nothing on screen distinguished this from an ordinary
       * editable table. Retention states what is actually true today — entries
       * are never pruned, because no pruning job exists. Naming a retention
       * period the system does not enforce would be a false claim in the one
       * screen that must not make them.
       */}
      <div className="bg-muted/50 text-muted-foreground flex items-start gap-2 rounded-md border px-3 py-2 text-xs">
        <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
        <p>
          <span className="text-foreground font-medium">{t('readOnlyTitle')}</span>{' '}
          {t('readOnlyBody')} {t('retentionUnknown')}
        </p>
      </div>

      {requestId ? (
        <div className="bg-muted flex items-center gap-2 rounded-md px-3 py-2 text-sm">
          <Link2 aria-hidden className="size-4 shrink-0" />
          <span className="force-ltr truncate">
            {t('filters.requestId')}: {requestId}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label={t('filters.clear')}
            onClick={() => setValues({ requestId: null, page: null })}
          >
            <X aria-hidden />
          </Button>
        </div>
      ) : null}

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
            onClick={() => setValues({ entityId: null, page: null })}
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
            onValueChange={(value) =>
              // A stale entityId scoped to the PREVIOUS entity would silently
              // filter to a combination that can never match.
              setValues({
                entity: value === ALL ? null : value,
                entityId: null,
                page: null,
              })
            }
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
            onValueChange={(value) =>
              setValues({ actorId: value === ALL ? null : value, page: null })
            }
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

        <div className="w-56 space-y-2">
          <Label htmlFor="audit-filter-action">{t('filters.action')}</Label>
          <Select
            value={action}
            onValueChange={(value) =>
              setValues({ action: value === ALL ? null : value, page: null })
            }
          >
            <SelectTrigger id="audit-filter-action">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('filters.all')}</SelectItem>
              {actions.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-40 space-y-2">
          <Label htmlFor="audit-filter-outcome">{t('filters.outcome')}</Label>
          <Select
            value={outcome}
            onValueChange={(value) =>
              setValues({ outcome: value === ALL ? null : value, page: null })
            }
          >
            <SelectTrigger id="audit-filter-outcome">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('filters.all')}</SelectItem>
              {OUTCOMES.map((option) => (
                <SelectItem key={option} value={option}>
                  {tOutcome(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-52 space-y-2">
          <Label htmlFor="audit-filter-entity-id">{t('filters.entityId')}</Label>
          {/* Uncontrolled-on-blur rather than per-keystroke: this filter drives
              a request AND a URL replace, and firing both on every character
              would spam the API and the history entry. */}
          <Input
            id="audit-filter-entity-id"
            className="force-ltr"
            defaultValue={entityId}
            key={entityId}
            placeholder={t('filters.entityIdPlaceholder')}
            onBlur={(event) => {
              const next = event.target.value.trim();
              if (next !== entityId) setValues({ entityId: next || null, page: null });
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
        </div>

        <div className="w-44 space-y-2">
          <Label htmlFor="audit-filter-from">{t('filters.from')}</Label>
          <DatePicker
            id="audit-filter-from"
            value={from}
            onChange={(value) => setValues({ from: value || null, page: null })}
          />
        </div>

        <div className="w-44 space-y-2">
          <Label htmlFor="audit-filter-to">{t('filters.to')}</Label>
          <DatePicker
            id="audit-filter-to"
            value={to}
            onChange={(value) => setValues({ to: value || null, page: null })}
          />
        </div>

        {hasFilters ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              setValues({
                entity: null,
                entityId: null,
                actorId: null,
                action: null,
                outcome: null,
                requestId: null,
                from: null,
                to: null,
                page: null,
              })
            }
          >
            {t('filters.clear')}
          </Button>
        ) : null}

        {/* Pushed to the end of the row: it acts on the whole filter, not on
            any single control next to it. */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ms-auto"
          disabled={isExporting || isLoading || (result?.entries.length ?? 0) === 0}
          onClick={() => void handleExport()}
        >
          <Download aria-hidden className="me-1 size-4" />
          {isExporting ? t('exporting') : t('exportCsv')}
        </Button>
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
              onClick={() => setValues({ page: String(Math.max(1, page - 1)) })}
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
                setValues({ page: String(Math.min(result.totalPages, page + 1)) })
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
