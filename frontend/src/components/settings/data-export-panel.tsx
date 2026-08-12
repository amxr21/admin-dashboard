'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Database, Download } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Timestamp } from '@/components/timestamp';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { fetchAudit, type AuditEntry } from '@/lib/audit-api';
import { exportResourceCsv, fetchSchema, type ResourceSchema } from '@/lib/resource-api';

/**
 * Data — export centre + export history (B3.3, scoped to those two; retention
 * policies and anonymisation rules are parked, see MASTER_TODO.md, both need
 * scheduled-job infrastructure that doesn't exist anywhere in this codebase).
 *
 * ─── NO NEW HISTORY MODEL ─────────────────────────────────────────────
 * Every export already writes an `audit()` entry (`<resource>.export`,
 * mirroring `audit.exported` for the audit trail's own CSV) — so "export
 * history" is just the audit trail read back, filtered to those actions. A
 * dedicated log would be a second copy of data the audit trail already owns.
 *
 * ─── RESOURCE LIST COMES FROM THE SAME SCHEMA THE RESOURCE PAGES USE ──
 * `GET /r/_schema` already returns exactly the resources this account can
 * reach (server-filtered by area) — the picker here has nothing to allowlist
 * on its own, it just renders that list.
 */
export function DataExportPanel() {
  const t = useTranslations('settings.data');
  const translateError = useTranslatedApiError();

  const [resources, setResources] = useState<ResourceSchema[] | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [isExporting, setIsExporting] = useState(false);
  const [schemaError, setSchemaError] = useState<string | null>(null);

  const [history, setHistory] = useState<AuditEntry[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void fetchSchema()
      .then((list) => {
        if (cancelled) return;
        setResources(list);
        setSelected((current) => current || (list[0]?.resource ?? ''));
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
      // is fetched unfiltered by action and narrowed client-side. The trail
      // is DEMO/staff-area gated already; this list is short in practice.
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

  const selectedLabel = useMemo(
    () => resources?.find((r) => r.resource === selected)?.label ?? selected,
    [resources, selected],
  );

  async function runExport() {
    if (!selected) return;

    setIsExporting(true);
    try {
      await exportResourceCsv(selected);
      toast.success(t('exported', { resource: selectedLabel }));
      await loadHistory();
    } catch (caught) {
      toast.error(translateError(caught));
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
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Select value={selected} onValueChange={setSelected} disabled={!resources}>
                <SelectTrigger className="w-56" aria-label={t('resourceLabel')}>
                  <SelectValue placeholder={t('resourceLabel')} />
                </SelectTrigger>
                <SelectContent>
                  {(resources ?? []).map((resource) => (
                    <SelectItem key={resource.resource} value={resource.resource}>
                      {resource.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                type="button"
                size="sm"
                disabled={!selected || isExporting}
                onClick={() => void runExport()}
              >
                <Download aria-hidden />
                {isExporting ? t('exporting') : t('export')}
              </Button>
            </div>
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
