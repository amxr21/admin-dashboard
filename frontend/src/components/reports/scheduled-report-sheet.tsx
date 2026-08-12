'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { useAppSettings } from '@/components/providers/settings-provider';
import { ApiError } from '@/lib/api';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import {
  createScheduledReport,
  updateScheduledReport,
  type ScheduledReport,
  type ScheduleFormat,
  type ScheduleFrequency,
} from '@/lib/scheduled-reports-api';

/**
 * Create or edit a scheduled report (C3.2) — a brief detour from the
 * schedules list, not a destination (see CLAUDE.md's Drawer vs. page rule,
 * C4.7): no standalone URL is worth bookmarking for "the form that adds one
 * more row to a list you're coming right back to."
 */

/**
 * One entry per schedulable report (mirrors the backend's `REPORT_REGISTRY`
 * in `reports.service.ts` — see that file if a report is added there and
 * needs to appear here too). `labelKey` reaches into `reports.scheduled.reportLabels.*`,
 * a label set independent of whether a report has its OWN catalogue page
 * yet (several of these — revenue, top-products, etc. — are sub-sections of
 * `/admin/reports/overview`, not standalone pages with their own `title` key).
 */
const REPORT_OPTIONS = [
  { key: 'overview', labelKey: 'overview' },
  { key: 'revenue', labelKey: 'revenue' },
  { key: 'top-products', labelKey: 'topProducts' },
  { key: 'status-breakdown', labelKey: 'statusBreakdown' },
  { key: 'fulfillment-health', labelKey: 'fulfillmentHealth' },
  { key: 'returns-summary', labelKey: 'returnsSummary' },
  { key: 'order-value-distribution', labelKey: 'orderValueDistribution' },
  { key: 'staff-activity', labelKey: 'staffActivity' },
  { key: 'category-breakdown', labelKey: 'categoryBreakdown' },
  { key: 'refund-rate-trend', labelKey: 'refundRateTrend' },
  { key: 'inventory-turnover', labelKey: 'inventoryTurnover' },
] as const;

const FREQUENCIES: ScheduleFrequency[] = ['DAILY', 'WEEKLY', 'MONTHLY'];
const FORMATS: ScheduleFormat[] = ['CSV', 'XLSX', 'PDF'];

interface ScheduledReportSheetProps {
  schedule: ScheduledReport | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (message: string) => void;
}

export function ScheduledReportSheet({ schedule, open, onOpenChange, onSaved }: ScheduledReportSheetProps) {
  const t = useTranslations('reports.scheduled.form');
  const tReportLabels = useTranslations('reports.scheduled.reportLabels');
  const translateError = useTranslatedApiError();
  const { editPanelMode } = useAppSettings();

  const isEdit = schedule !== null;

  const [reportKey, setReportKey] = useState('overview');
  const [frequency, setFrequency] = useState<ScheduleFrequency>('DAILY');
  const [format, setFormat] = useState<ScheduleFormat>('CSV');
  const [recipientsText, setRecipientsText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReportKey(schedule?.reportKey ?? 'overview');
    setFrequency(schedule?.frequency ?? 'DAILY');
    setFormat(schedule?.format ?? 'CSV');
    setRecipientsText(schedule?.recipients.join(', ') ?? '');
    setError(null);
  }, [open, schedule]);

  async function submit() {
    const recipients = recipientsText
      .split(/[,\n]/)
      .map((r) => r.trim())
      .filter(Boolean);

    if (recipients.length === 0) {
      setError(t('recipientsRequired'));
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await (isEdit
        ? updateScheduledReport(schedule.id, { reportKey, frequency, format, recipients })
        : createScheduledReport({ reportKey, frequency, format, recipients }));

      const reportLabelKey = REPORT_OPTIONS.find((o) => o.key === reportKey)?.labelKey ?? reportKey;
      onSaved(t(isEdit ? 'updated' : 'created', { report: tReportLabels(reportLabelKey) }));
      onOpenChange(false);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 400 ? caught.message : translateError(caught),
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="end"
        variant={editPanelMode}
        className="w-full max-w-md overflow-y-auto"
        title={isEdit ? t('editTitle') : t('createTitle')}
      >
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">{isEdit ? t('editTitle') : t('createTitle')}</h2>

          {error ? (
            <p role="alert" className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
              {error}
            </p>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="schedule-report">{t('fields.report')}</Label>
            <Select value={reportKey} onValueChange={setReportKey}>
              <SelectTrigger id="schedule-report">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REPORT_OPTIONS.map((option) => (
                  <SelectItem key={option.key} value={option.key}>
                    {tReportLabels(option.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="schedule-frequency">{t('fields.frequency')}</Label>
            <Select value={frequency} onValueChange={(v) => setFrequency(v as ScheduleFrequency)}>
              <SelectTrigger id="schedule-frequency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FREQUENCIES.map((freq) => (
                  <SelectItem key={freq} value={freq}>
                    {t(`frequencies.${freq}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="schedule-format">{t('fields.format')}</Label>
            <Select value={format} onValueChange={(v) => setFormat(v as ScheduleFormat)}>
              <SelectTrigger id="schedule-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FORMATS.map((fmt) => (
                  <SelectItem key={fmt} value={fmt}>
                    {fmt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="schedule-recipients">{t('fields.recipients')}</Label>
            <Textarea
              id="schedule-recipients"
              value={recipientsText}
              onChange={(event) => setRecipientsText(event.target.value)}
              placeholder={t('recipientsPlaceholder')}
              rows={3}
              className="force-ltr"
            />
            <p className="text-muted-foreground text-xs">{t('recipientsHint')}</p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              {t('cancel')}
            </Button>
            <Button type="button" onClick={() => void submit()} disabled={isSaving}>
              {isSaving ? t('saving') : t('save')}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
