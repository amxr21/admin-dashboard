'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';

import { EmptyState } from '@/components/empty-state';
import { ErrorSection } from '@/components/errors/error-section';
import { LoadingState } from '@/components/ui/loading-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useReportQuery } from '@/hooks/useReportQuery';
import { fetchProductsWithoutReviews, type ProductsWithoutReviews } from '@/lib/reports-api';

/**
 * Products with no reviews (C3.5) — live catalogue state, not date-range
 * scoped ("has this product ever been reviewed" doesn't reset every
 * period), same category as the dashboard's needs-attention queues.
 */
export function ProductsWithoutReviewsView() {
  const t = useTranslations('reports.productsWithoutReviews');
  const tStates = useTranslations('states');

  const query = useCallback(() => fetchProductsWithoutReviews(), []);
  const { data, isLoading, error, load } = useReportQuery<ProductsWithoutReviews>(query);

  return (
    <div className="space-y-4">
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorSection title={tStates('error.title')} description={error} onRetry={() => void load()} />
      ) : data?.products.length === 0 ? (
        <EmptyState title={t('empty.title')} description={t('empty.description')} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.product')}</TableHead>
                <TableHead>{t('columns.sku')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.products.map((row) => (
                <TableRow key={row.productId}>
                  <TableCell>{row.name}</TableCell>
                  <TableCell className="force-ltr">{row.sku ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
