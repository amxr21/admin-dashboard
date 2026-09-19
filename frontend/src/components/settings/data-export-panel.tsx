'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Database, Download } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { DateRangeField } from '@/components/reports/date-range-field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Timestamp } from '@/components/timestamp';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { fetchAudit, type AuditEntry } from '@/lib/audit-api';
import {
  exportResourceCsv,
  fetchSchema,
  type FieldConfig,
  type ResourceSchema,
} from '@/lib/resource-api';

/**
 * Data — export centre + export history (B3.3).
 *
 * ─── NO NEW HISTORY MODEL ─────────────────────────────────────────────
 * Every export already writes an `audit()` entry (`<resource>.export`), so
 * "export history" is just the audit trail read back, filtered to those
 * actions. A dedicated log would be a second copy of data the audit trail
 * already owns.
 *
 * ─── RESOURCE LIST COMES FROM THE SAME SCHEMA THE RESOURCE PAGES USE ──
 * `GET /r/_schema` already returns exactly the resources this account can
 * reach (server-filtered by area), so the picker has nothing to allowlist on
 * its own — it just renders that list, columns included.
 *
 * ─── ONE FILE PER RESOURCE, NOT ONE MERGED FILE ──────────────────────
 * Selecting several resources downloads several CSVs, sequentially. Merging
 * them is not a thing a CSV can express: products and orders share no columns,
 * so one combined header row would describe neither. The endpoint is per
 * resource for the same reason.
 *
 * ─── WHY THERE IS NO "CURRENT FILTERS" CONTROL HERE ──────────────────
 * That scope only means something where a filtered list is already on screen —
 * the resource table's own Export button, which passes its live search and
 * filters through the same client. This panel has no list state to inherit, so
 * offering it here would be a control with nothing behind it.
 */

/** Columns the export endpoint cannot emit — the CSV builder skips them
 *  server-side, so offering them here would promise a column that never
 *  arrives. Mirrors the `type !== 'multiRelation'` filter in the route. */
function exportableFields(schema: ResourceSchema): FieldConfig[] {
  return schema.fields.filter((field) => field.type !== 'multiRelation');
}

function dateFields(schema: ResourceSchema): FieldConfig[] {
  return schema.fields.filter((field) => field.type === 'date' || field.type === 'datetime');
}

export function DataExportPanel() {
  const t = useTranslations('settings.data');
  const translateError = useTranslatedApiError();

  const [resources, setResources] = useState<ResourceSchema[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [schemaError, setSchemaError] = useState<string | null>(null);

  /**
   * Hidden columns per resource, as a DENYLIST — the same direction
   * `useColumnVisibility` uses, and for the same reason: a resource's column
   * set can grow, and an allowlist would silently drop every column added
   * after the choice was made. Absent key means "everything included".
   */
  const [hiddenColumns, setHiddenColumns] = useState<Record<string, string[]>>({});

  /** Which date field the window applies to, per resource. Empty means no
   *  date limit at all, which is the default and the common case. */
  const [dateFieldByResource, setDateFieldByResource] = useState<Record<string, string>>({});
  const [range, setRange] = useState({ from: '', to: '' });

  const [history, setHistory] = useState<AuditEntry[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void fetchSchema()
      .then((list) => {
        if (cancelled) return;
        setResources(list);
        // Preselecting the first keeps the panel's original one-click
        // behaviour for the common "export this one thing" case.
        setSelected((current) => (current.length > 0 ? current : list[0] ? [list[0].resource] : []));
      })
      .catch((caught: unknown) => {
        if (!cancelled) setSchemaError(translateError(caught));
      });

    return () => {
      cancelled = true;
    };
  }, [translateError]);

  const loadHistory = useCallback(async () => {
    setIsHistoryLoading(true);
    setHistoryError(null);
    try {
      // A generic `.export` suffix would also match every resource's action
      // in one request, but the audit filter is an exact match — so history
      // is fetched unfiltered by action and narrowed client-side.
      const result = await fetchAudit({ pageSize: 20 });
      setHistory(result.entries.filter((entry) => entry.action.endsWith('.export')));
    } catch (caught) {
      setHistoryError(translateError(caught));
      setHistory(null);
    } finally {
      setIsHistoryLoading(false);
    }
  }, [translateError]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const selectedSchemas = useMemo(
    () => (resources ?? []).filter((schema) => selected.includes(schema.resource)),
    [resources, selected],
  );

  function toggleResource(resource: string, checked: boolean) {
    setSelected((current) =>
      checked ? [...current, resource] : current.filter((name) => name !== resource),
    );
  }

  function toggleColumn(resource: string, field: string, checked: boolean) {
    setHiddenColumns((current) => {
      const hidden = new Set(current[resource] ?? []);
      if (checked) hidden.delete(field);
      else hidden.add(field);
      return { ...current, [resource]: [...hidden] };
    });
  }

  /** The column names to SEND for one resource, or undefined for "all of
   *  them" — the server treats an absent list as every exportable column, so
   *  an untouched picker keeps the historical behaviour exactly. */
  function columnsFor(schema: ResourceSchema): string[] | undefined {
    const hidden = hiddenColumns[schema.resource] ?? [];
    if (hidden.length === 0) return undefined;
    return exportableFields(schema)
      .filter((field) => !hidden.includes(field.name))
      .map((field) => field.name);
  }

  /** True when every column of a selected resource has been unticked — the
   *  one combination the server would refuse, caught here so the refusal is
   *  visible next to the checkboxes rather than as a failed download. */
  const hasEmptyColumnSelection = selectedSchemas.some(
    (schema) => (columnsFor(schema)?.length ?? 1) === 0,
  );

  async function runExport() {
    if (selected.length === 0 || hasEmptyColumnSelection) return;

    setIsExporting(true);
    const exportedLabels: string[] = [];

    try {
      // Sequential, not parallel: each call triggers a real browser download,
      // and several at once is where browsers start silently blocking them.
      for (const schema of selectedSchemas) {
        const dateField = dateFieldByResource[schema.resource] ?? '';
        const columns = columnsFor(schema);

        try {
          await exportResourceCsv(schema.resource, {
            ...(columns ? { columns } : {}),
            // All three travel together or not at all — a bound with no field
            // has nothing to apply to, and the server rejects that pairing.
            ...(dateField && (range.from || range.to)
              ? {
                  dateField,
                  ...(range.from ? { dateFrom: range.from } : {}),
                  ...(range.to ? { dateTo: range.to } : {}),
                }
              : {}),
          });
          exportedLabels.push(schema.label);
        } catch (caught) {
          // One resource failing must not abandon the rest — each file is an
          // independent request, and the partial result is still useful.
          toast.error(`${t('exportFailedFor', { resource: schema.label })} ${translateError(caught)}`);
        }
      }

      if (exportedLabels.length === 1) {
        toast.success(t('exported', { resource: exportedLabels[0] ?? '' }));
      } else if (exportedLabels.length > 1) {
        toast.success(t('exportedMultiple', { count: exportedLabels.length }));
      }

      if (exportedLabels.length > 0) await loadHistory();
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <section aria-labelledby="settings-group-data" className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Database className="text-primary size-5" aria-hidden="true" />
          <h2 id="settings-group-data" className="text-lg font-semibold tracking-tight">
            {t('title')}
          </h2>
        </div>
        <p className="text-muted-foreground text-sm">{t('description')}</p>
      </div>

      <div className="bg-card/50 space-y-4 rounded-lg border p-4">
        <div className="space-y-2">
          <p className="text-sm font-medium">{t('exportTitle')}</p>
          <p className="text-muted-foreground text-sm">{t('exportDescription')}</p>

          {schemaError ? (
            <p className="text-destructive text-sm">{schemaError}</p>
          ) : resources === null ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (
            <>
              <fieldset className="space-y-2">
                <legend className="sr-only">{t('resourceLabel')}</legend>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{t('resourceLabel')}</p>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelected(resources.map((schema) => schema.resource))}
                    >
                      {t('selectAllResources')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelected([])}
                    >
                      {t('clearResources')}
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {resources.map((schema) => (
                    <div key={schema.resource} className="flex items-center gap-2">
                      <Checkbox
                        id={`export-resource-${schema.resource}`}
                        checked={selected.includes(schema.resource)}
                        onCheckedChange={(checked) =>
                          toggleResource(schema.resource, checked === true)
                        }
                      />
                      <Label htmlFor={`export-resource-${schema.resource}`}>{schema.label}</Label>
                    </div>
                  ))}
                </div>

                <p className="text-muted-foreground text-sm">
                  {t('selectedCount', { count: selected.length })}
                </p>
              </fieldset>

              {selectedSchemas.length > 0 ? (
                <div className="space-y-4 border-t pt-4">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{t('columnsTitle')}</p>
                    <p className="text-muted-foreground text-sm">{t('columnsDescription')}</p>
                  </div>

                  {selectedSchemas.map((schema) => {
                    const fields = exportableFields(schema);
                    const hidden = hiddenColumns[schema.resource] ?? [];
                    const includedCount = fields.length - hidden.length;

                    return (
                      <fieldset key={schema.resource} className="space-y-2">
                        <legend className="text-sm font-medium">
                          {t('columnsFor', { resource: schema.label })}
                        </legend>
                        <p className="text-muted-foreground text-xs">
                          {t('columnsSelected', { count: includedCount, total: fields.length })}
                        </p>

                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                          {fields.map((field) => (
                            <div key={field.name} className="flex items-center gap-2">
                              <Checkbox
                                id={`export-column-${schema.resource}-${field.name}`}
                                checked={!hidden.includes(field.name)}
                                onCheckedChange={(checked) =>
                                  toggleColumn(schema.resource, field.name, checked === true)
                                }
                              />
                              <Label
                                htmlFor={`export-column-${schema.resource}-${field.name}`}
                                className="text-sm font-normal"
                              >
                                {field.label}
                              </Label>
                            </div>
                          ))}
                        </div>

                        {includedCount === 0 ? (
                          <p role="alert" className="text-destructive text-sm">
                            {t('columnsNoneWarning')}
                          </p>
                        ) : null}
                      </fieldset>
                    );
                  })}

                  <div className="space-y-2 border-t pt-4">
                    <p className="text-sm font-medium">{t('dateTitle')}</p>
                    <p className="text-muted-foreground text-sm">{t('dateDescription')}</p>

                    {/*
                      One narrow select per selected resource, laid out side by
                      side rather than stacked. Selecting several resources used
                      to produce a full-page column of near-identical
                      label+select pairs ("Created" / "No date limit", over and
                      over) — a lot of vertical space for what is really one
                      short choice per resource.

                      Three across, not the six a wide screen could physically
                      fit: each trigger still has to show a field name plus its
                      chevron without truncating, and six columns on a 1280px
                      laptop leaves roughly 180px each, which is where these
                      labels start clipping. Two on tablet, one on phone — the
                      panel has to stay usable at ~400px.
                    */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {selectedSchemas.map((schema) => {
                        const available = dateFields(schema);
                        const fieldId = `export-datefield-${schema.resource}`;

                        // Still one cell in the same grid, so a resource with
                        // no date field keeps its place next to its siblings
                        // instead of breaking the row it belongs to.
                        if (available.length === 0) {
                          return (
                            <p key={schema.resource} className="text-muted-foreground text-sm">
                              {schema.label}: {t('dateUnavailable')}
                            </p>
                          );
                        }

                        return (
                          <div key={schema.resource} className="min-w-0 space-y-2">
                            {/* The resource name stays ON each select — with
                                several in a row, an unlabelled one is
                                unattributable. */}
                            <Label htmlFor={fieldId} className="truncate">
                              {t('columnsFor', { resource: schema.label })}
                            </Label>
                            <Select
                              value={dateFieldByResource[schema.resource] ?? ''}
                              onValueChange={(value) =>
                                setDateFieldByResource((current) => ({
                                  ...current,
                                  [schema.resource]: value === '__none__' ? '' : value,
                                }))
                              }
                            >
                              <SelectTrigger id={fieldId} aria-label={t('dateFieldLabel')}>
                                <SelectValue placeholder={t('dateFieldNone')} />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">{t('dateFieldNone')}</SelectItem>
                                {available.map((field) => (
                                  <SelectItem key={field.name} value={field.name}>
                                    {field.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        );
                      })}
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <DateRangeField
                        range={range}
                        onChange={setRange}
                        idPrefix="export-range"
                        // The window is genuinely optional here — "export
                        // everything" is the default, so both ends must be
                        // clearable back to empty.
                        optional
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">{t('noResourceSelected')}</p>
              )}

              <Button
                type="button"
                size="sm"
                disabled={selected.length === 0 || hasEmptyColumnSelection || isExporting}
                onClick={() => void runExport()}
              >
                <Download aria-hidden />
                {isExporting
                  ? t('exporting')
                  : selected.length > 1
                    ? t('exportMultiple', { count: selected.length })
                    : t('export')}
              </Button>
            </>
          )}
        </div>

        <div className="space-y-2 border-t pt-4">
          <p className="text-sm font-medium">{t('historyTitle')}</p>

          {historyError ? (
            <div className="space-y-2">
              <p className="text-destructive text-sm">{historyError}</p>
              <Button variant="outline" size="sm" onClick={() => void loadHistory()}>
                {t('retry')}
              </Button>
            </div>
          ) : isHistoryLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : history && history.length > 0 ? (
            <ul className="divide-y">
              {history.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{entry.entity}</p>
                    <p className="text-muted-foreground text-xs">
                      {entry.actorEmail ?? t('unknownActor')}
                    </p>
                  </div>
                  <Timestamp value={entry.createdAt} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">{t('historyEmpty')}</p>
          )}
        </div>
      </div>
    </section>
  );
}
