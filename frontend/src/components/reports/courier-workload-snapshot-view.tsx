'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

import { ErrorSection } from '@/components/errors/error-section';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
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
  const translateError = useTranslatedApiError();

  const [data, setData] = useState<CourierWorkloadSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setData(await fetchCourierWorkloadSnapshot());
    } catch (caught) {
      setError(translateError(caught));
    } finally {
      setIsLoading(false);
    }
  }, [translateError]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      {isLoading ? (
        <Skeleton className="h-64 w-full" />
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
