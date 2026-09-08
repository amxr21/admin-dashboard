'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { PencilLine, ScrollText } from 'lucide-react';

import { DataTable, type Column } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { TablePagination } from '@/components/table-pagination';
import { EmptyState } from '@/components/empty-state';
import { ErrorSection } from '@/components/errors/error-section';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { Button } from '@/components/ui/button';
import { ShiftSummarySheet } from '@/components/staff/shift-summary-sheet';
import { fetchShifts, type Shift, type ShiftListResult } from '@/lib/shifts-api';

/**
 * Who worked when (F6.5).
 *
 * ─── SHARES A PAGE WITH LOGIN HISTORY, DELIBERATELY ──────────────────
 * Both answer "what have staff been doing", both are guarded by `staff`, and
 * both are read by the same person at the same moment. Two near-identical
 * pages would mean whoever is looking has to already know which of them holds
 * the answer — see the login-history page's own note on why it is not a saved
 * filter on the audit trail, for the same reasoning applied one level up.
 *
 * ─── AN EDITED SHIFT SAYS SO ─────────────────────────────────────────
 * The whole point of keeping the original times is that a reader can tell a
 * clocked hour from a corrected one. A table that renders both identically
 * throws that away at the last step.
 */

interface ShiftsTableProps {
  /** True for "who is on now", false for the full history. */
  openOnly?: boolean;
}

export function ShiftsTable({ openOnly = false }: ShiftsTableProps) {
  const t = useTranslations('shifts.table');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();

  const [result, setResult] = useState<ShiftListResult | null>(null);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summaryFor, setSummaryFor] = useState<Shift | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      setResult(await fetchShifts({ page, pageSize: 20, open: openOnly }));
    } catch (caught) {
      setError(translateError(caught));
      setResult(null);
    } finally {
      setIsLoading(false);
    }
  }, [page, openOnly, translateError]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Hours and minutes, or "—" while a shift is still running: a duration for
   *  an open shift would be stale the instant it rendered. */
  function duration(shift: Shift): string {
    if (shift.endedAt === null) return '—';

    const ms = new Date(shift.endedAt).getTime() - new Date(shift.startedAt).getTime();
    const minutes = Math.max(0, Math.round(ms / 60_000));

    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
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
      id: 'ended',
      header: t('ended'),
      cell: (shift) =>
        shift.endedAt === null ? (
          // Icon-bearing badge, not colour alone — the app-wide rule.
          <Badge variant="success">{t('onNow')}</Badge>
        ) : (
          <span className="tabular-nums">
            {formatter.dateTime(new Date(shift.endedAt), 'short')}
          </span>
        ),
    },
    {
      id: 'duration',
      header: t('duration'),
      align: 'end',
      cell: (shift) => <span className="tabular-nums">{duration(shift)}</span>,
    },
    {
      id: 'summary',
      header: '',
      cell: (shift) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSummaryFor(shift)}
          aria-label={t('summaryFor', { name: shift.user.name ?? shift.user.email })}
        >
          <ScrollText className="size-4" aria-hidden />
        </Button>
      ),
    },
    {
      id: 'edited',
      header: t('edited'),
      cell: (shift) =>
        shift.wasEdited ? (
          <span
            className="text-muted-foreground flex items-center gap-1.5 text-sm"
            // The reason and the original are the two facts a reader needs to
            // judge a corrected timesheet; both go in the title so neither
            // needs another click.
            title={t('editedBy', {
              name: shift.editedBy?.name ?? shift.editedBy?.email ?? '',
              reason: shift.editReason ?? '',
            })}
          >
            <PencilLine className="size-3.5 shrink-0" aria-hidden />
            {t('corrected')}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  if (error) {
    return <ErrorSection title={t('loadFailed')} description={error} onRetry={() => void load()} />;
  }

  if (!isLoading && result && result.shifts.length === 0) {
    return (
      <EmptyState
        title={openOnly ? t('emptyOpenTitle') : t('emptyTitle')}
        description={openOnly ? t('emptyOpenBody') : t('emptyBody')}
      />
    );
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

      <ShiftSummarySheet
        shift={summaryFor}
        open={summaryFor !== null}
        onOpenChange={(next) => {
          if (!next) setSummaryFor(null);
        }}
      />
    </div>
  );
}
