'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Check, X } from 'lucide-react';
import { toast } from 'sonner';

import { DataTable, type Column } from '@/components/data-table';
import { TablePagination } from '@/components/table-pagination';
import { EmptyState } from '@/components/empty-state';
import { ErrorSection } from '@/components/errors/error-section';
import { Badge } from '@/components/ui/badge';
import { RowActions, type RowAction } from '@/components/row-actions';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import {
  approveShift,
  fetchShifts,
  rejectShift,
  type Shift,
  type ShiftListResult,
} from '@/lib/shifts-api';

/**
 * A manager's shift-approval queue (O9.19).
 *
 * ─── A RECORD, NOT A GATE ─────────────────────────────────────────────
 * Every shift here already started and the till already worked — see
 * `Shift.approvalStatus`'s own comment. This page exists so a manager can
 * confirm afterward (or while it's still running) that what they're seeing
 * is legitimate, not so they can hold someone up.
 *
 * ─── SEPARATE FROM `ShiftsTable` ──────────────────────────────────────
 * That component (on `/admin/login-history`, behind `staff`) is the FULL
 * history — every shift, every role, forever. This is a MANAGER's queue —
 * behind `shifts`, which MANAGER holds and `staff` does not — scoped to what
 * needs a decision. Folding approval controls into the full history table
 * would put an action a manager can take on rows only an owner can normally
 * even see, since the two pages answer different questions for different
 * people.
 */
export function ShiftApprovalQueue() {
  const t = useTranslations('shifts.approval');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();

  const [result, setResult] = useState<ShiftListResult | null>(null);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Shift | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [isRejecting, setIsRejecting] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      setResult(await fetchShifts({ page, pageSize: 20, approvalStatus: 'PENDING' }));
    } catch (caught) {
      setError(translateError(caught));
      setResult(null);
    } finally {
      setIsLoading(false);
    }
  }, [page, translateError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleApprove(shift: Shift) {
    setBusyId(shift.id);
    try {
      await approveShift(shift.id);
      toast.success(t('approved', { name: shift.user.name ?? shift.user.email }));
      await load();
    } catch (caught) {
      toast.error(translateError(caught));
    } finally {
      setBusyId(null);
    }
  }

  function openReject(shift: Shift) {
    setRejecting(shift);
    setRejectNote('');
  }

  async function confirmReject() {
    if (!rejecting || rejectNote.trim() === '') return;

    setIsRejecting(true);
    try {
      await rejectShift(rejecting.id, rejectNote.trim());
      toast.success(t('rejected', { name: rejecting.user.name ?? rejecting.user.email }));
      setRejecting(null);
      setRejectNote('');
      await load();
    } catch (caught) {
      toast.error(translateError(caught));
    } finally {
      setIsRejecting(false);
    }
  }

  const columns: readonly Column<Shift>[] = [
    {
      id: 'person',
      header: t('person'),
      cell: (shift) => shift.user.name ?? shift.user.email,
    },
    {
      id: 'branch',
      header: t('branch'),
      cell: (shift) => shift.branch.name,
    },
    {
      id: 'started',
      header: t('started'),
      cell: (shift) => (
        <span className="tabular-nums">
          {formatter.dateTime(new Date(shift.startedAt), 'short')}
        </span>
      ),
    },
    {
      id: 'status',
      header: t('status'),
      cell: (shift) =>
        shift.endedAt === null ? (
          <Badge variant="success">{t('stillOnShift')}</Badge>
        ) : (
          <span className="tabular-nums">
            {formatter.dateTime(new Date(shift.endedAt), 'short')}
          </span>
        ),
    },
    {
      id: 'actions',
      header: '',
      cell: (shift) => {
        const actions: readonly RowAction[] = [
          {
            id: 'approve',
            label: t('approve'),
            icon: Check,
            onClick: () => void handleApprove(shift),
            disabled: busyId !== null,
          },
          {
            id: 'reject',
            label: t('reject'),
            icon: X,
            variant: 'destructive',
            onClick: () => openReject(shift),
            disabled: busyId !== null,
          },
        ];

        return <RowActions actions={actions} />;
      },
    },
  ];

  if (error) {
    return <ErrorSection title={t('loadFailed')} description={error} onRetry={() => void load()} />;
  }

  if (!isLoading && result && result.shifts.length === 0) {
    return <EmptyState title={t('emptyTitle')} description={t('emptyBody')} />;
  }

  return (
    <div className="space-y-4">
      <DataTable
        data={result?.shifts ?? []}
        columns={columns}
        getRowId={(shift) => shift.id}
        isLoading={isLoading}
      />

      {result && result.totalPages > 1 ? (
        <TablePagination
          page={result.page}
          totalPages={result.totalPages}
          total={result.total}
          pageSize={result.pageSize}
          onPageChange={setPage}
        />
      ) : null}

      <AlertDialog
        open={rejecting !== null}
        onOpenChange={(next) => {
          if (!next) {
            setRejecting(null);
            setRejectNote('');
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('rejectTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {rejecting
                ? t('rejectBody', { name: rejecting.user.name ?? rejecting.user.email })
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2 text-start">
            <Label htmlFor="reject-note">{t('rejectReasonLabel')}</Label>
            <Textarea
              id="reject-note"
              value={rejectNote}
              onChange={(event) => setRejectNote(event.target.value)}
              placeholder={t('rejectReasonPlaceholder')}
              autoFocus
              disabled={isRejecting}
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRejecting}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmReject()}
              disabled={isRejecting || rejectNote.trim() === ''}
            >
              {isRejecting ? t('rejecting') : t('reject')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
