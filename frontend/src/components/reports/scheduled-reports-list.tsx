'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Pencil, Play, Plus, PowerOff, Send, Trash2 } from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { ErrorSection } from '@/components/errors/error-section';
import { RowActions, type RowAction } from '@/components/row-actions';
import { ScheduledReportSheet } from '@/components/reports/scheduled-report-sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Timestamp } from '@/components/timestamp';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import {
  deleteScheduledReport,
  fetchScheduledReports,
  sendScheduledReportNow,
  updateScheduledReport,
  type ScheduledReport,
} from '@/lib/scheduled-reports-api';

/**
 * The schedules list (C3.2). A REGISTRY-scoped list, not per-report — every
 * scheduled report across every domain shows here, one place to see what's
 * mailing on a timer rather than a scattered toggle per report page.
 */
export function ScheduledReportsList() {
  const t = useTranslations('reports.scheduled');
  const tReportLabels = useTranslations('reports.scheduled.reportLabels');
  const tStates = useTranslations('states');
  const translateError = useTranslatedApiError();

  const [schedules, setSchedules] = useState<ScheduledReport[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduledReport | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ScheduledReport | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setSchedules(await fetchScheduledReports());
    } catch (caught) {
      setError(translateError(caught));
    } finally {
      setIsLoading(false);
    }
  }, [translateError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleActive(schedule: ScheduledReport) {
    try {
      await updateScheduledReport(schedule.id, { isActive: !schedule.isActive });
      await load();
    } catch (caught) {
      toast.error(translateError(caught));
    }
  }

  async function runDelete() {
    if (!pendingDelete) return;
    setIsDeleting(true);
    try {
      await deleteScheduledReport(pendingDelete.id);
      toast.success(t('deleted'));
      setPendingDelete(null);
      await load();
    } catch (caught) {
      toast.error(translateError(caught));
    } finally {
      setIsDeleting(false);
    }
  }

  async function sendNow(schedule: ScheduledReport) {
    setSendingId(schedule.id);
    try {
      const outcome = await sendScheduledReportNow(schedule.id);
      if (outcome.sent) {
        toast.success(t('sendNowSuccess'));
      } else {
        // A real, honest reason — "not configured" is expected in dev and
        // worth saying so, not disguising as a generic failure.
        toast.error(t('sendNowFailed', { reason: outcome.reason ?? '' }));
      }
      await load();
    } catch (caught) {
      toast.error(translateError(caught));
    } finally {
      setSendingId(null);
    }
  }

  function reportLabel(reportKey: string): string {
    // Falls back to the raw key for a report the frontend doesn't know a
    // label for yet (e.g. one added to the backend registry but not here) —
    // an honest gap beats a translation-key path leaking onto the screen.
    return tReportLabels.has(reportKey) ? tReportLabels(reportKey) : reportKey;
  }

  function rowActionsFor(schedule: ScheduledReport): RowAction[] {
    return [
      {
        id: 'edit',
        label: t('actions.edit', { report: reportLabel(schedule.reportKey) }),
        icon: Pencil,
        onClick: () => {
          setEditing(schedule);
          setSheetOpen(true);
        },
      },
      {
        id: 'toggle',
        label: t(schedule.isActive ? 'actions.deactivate' : 'actions.activate', {
          report: reportLabel(schedule.reportKey),
        }),
        icon: schedule.isActive ? PowerOff : Play,
        onClick: () => void toggleActive(schedule),
      },
      {
        id: 'delete',
        label: t('actions.delete', { report: reportLabel(schedule.reportKey) }),
        icon: Trash2,
        variant: 'destructive',
        onClick: () => setPendingDelete(schedule),
      },
    ];
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t('title')}</h2>
          <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setSheetOpen(true);
          }}
        >
          <Plus className="size-4" aria-hidden />
          {t('add')}
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : error ? (
        <ErrorSection title={tStates('error.title')} description={error} onRetry={() => void load()} />
      ) : schedules && schedules.length === 0 ? (
        <EmptyState title={t('empty.title')} description={t('empty.description')} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.report')}</TableHead>
                <TableHead>{t('columns.frequency')}</TableHead>
                <TableHead>{t('columns.recipients')}</TableHead>
                <TableHead>{t('columns.lastRun')}</TableHead>
                <TableHead>{t('columns.status')}</TableHead>
                <TableHead className="text-end">{t('columns.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schedules?.map((schedule) => (
                <TableRow key={schedule.id}>
                  <TableCell>{reportLabel(schedule.reportKey)}</TableCell>
                  <TableCell>{t(`form.frequencies.${schedule.frequency}`)}</TableCell>
                  <TableCell className="force-ltr max-w-48 truncate" title={schedule.recipients.join(', ')}>
                    {schedule.recipients.join(', ')}
                  </TableCell>
                  <TableCell>
                    {schedule.lastRunAt ? (
                      <Timestamp value={schedule.lastRunAt} />
                    ) : (
                      <span className="text-muted-foreground">{t('neverRun')}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={schedule.isActive ? 'success' : 'muted'}>
                      {t(schedule.isActive ? 'active' : 'inactive')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-end">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={sendingId === schedule.id}
                        onClick={() => void sendNow(schedule)}
                        aria-label={t('sendNowAction', { report: reportLabel(schedule.reportKey) })}
                      >
                        <Send aria-hidden />
                      </Button>
                      <RowActions actions={rowActionsFor(schedule)} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ScheduledReportSheet
        schedule={editing}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onSaved={(message) => {
          toast.success(message);
          void load();
        }}
      />

      <AlertDialog open={pendingDelete !== null} onOpenChange={(next) => !next && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteConfirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? t('deleteConfirm.description', { report: reportLabel(pendingDelete.reportKey) })
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t('deleteConfirm.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={(event) => {
                event.preventDefault();
                void runDelete();
              }}
            >
              {isDeleting ? t('deleteConfirm.deleting') : t('deleteConfirm.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
