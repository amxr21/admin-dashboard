'use client';

import { useCallback } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import { ErrorSection } from '@/components/errors/error-section';
import { Badge } from '@/components/ui/badge';
import { LoadingState } from '@/components/ui/loading-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useReportQuery } from '@/hooks/useReportQuery';
import { fetchCourierWorkloadSnapshot, type CourierWorkloadSnapshot } from '@/lib/reports-api';

/**
 * Courier workload / active-roster snapshot (C3.5) — live counts of
 * couriers by status and their current open (non-terminal) assignment
 * count. Live state, not date-range scoped, same as needs-attention.
 */
export function CourierWorkloadSnapshotView() {
  const t = useTranslations('reports.courierWorkloadSnapshot');
  const tStates = useTranslations('states');
  const formatter = useFormatter();

  const query = useCallback(() => fetchCourierWorkloadSnapshot(), []);
  const { data, isLoading, error, load } = useReportQuery<CourierWorkloadSnapshot>(query);

  return (
    <div className="space-y-4">
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorSection title={tStates('error.title')} description={error} onRetry={() => void load()} />
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            {data?.byStatus.map((row) => (
              <div key={row.status} className="bg-card rounded-lg border p-4">
                <p className="text-muted-foreground text-sm font-medium">{row.status}</p>
                <p className="mt-1 text-xl font-semibold tabular-nums">{formatter.number(row.count)}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('columns.courier')}</TableHead>
                  <TableHead>{t('columns.status')}</TableHead>
                  <TableHead className="text-end">{t('columns.openAssignments')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.couriers.map((row) => (
                  <TableRow key={row.driverId}>
                    <TableCell>{row.name}</TableCell>
                    <TableCell>
                      <Badge variant={row.status === 'ACTIVE' || row.status === 'ON_SHIFT' ? 'success' : 'muted'}>
                        {row.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-end tabular-nums">{formatter.number(row.openAssignments)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
