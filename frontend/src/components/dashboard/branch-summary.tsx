'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { RefreshCw, Store, Warehouse } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { writeBranchId } from '@/lib/auth-storage';
import {
  fetchBranchComparison,
  type BranchComparisonRow,
  type DateRange,
} from '@/lib/reports-api';

/**
 * Every branch side by side, shown only when there is more than one.
 *
 * ─── WHY A SINGLE-BRANCH BUSINESS SEES NOTHING ───────────────────────
 * A comparison of one is not a comparison — it would repeat the KPI strip
 * directly above it under a heading promising more. The component renders
 * `null` rather than an empty state, because "you have one branch" is not a
 * problem needing an explanation.
 *
 * ─── AGGREGATE VS. BRANCH ────────────────────────────────────────────
 * The KPI strip above is the AGGREGATE (or the active branch, if one is
 * selected in the switcher). This table is always every branch, unscoped, so
 * the two answer different questions and the heading says which. Deliberately
 * fewer columns than the overview: new customers are not branch-scoped and
 * low stock is a point-in-time count, so neither belongs in a row a reader
 * would be tempted to add up.
 *
 * ─── CLICKING A ROW SWITCHES THE WORKSPACE ───────────────────────────
 * It writes the branch and reloads, the same deliberate full reload the
 * topbar switcher uses (see `branch-switcher.tsx` on why scoping cannot be a
 * local state update). Anything cheaper would leave the rest of the shell
 * showing another branch's data under this branch's name.
 */
export function BranchSummary({ range }: { range: DateRange }) {
  const t = useTranslations('dashboard.branchSummary');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();

  const [rows, setRows] = useState<BranchComparisonRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(() => {
    setIsLoading(true);
    setError(null);

    return fetchBranchComparison(range)
      .then((result) => {
        setRows(result.branches);
      })
      .catch((caught: unknown) => {
        setError(translateError(caught));
        // Clear rather than keep: a failed reload must not leave the previous
        // range's figures on screen under the new range's heading.
        setRows(null);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [range, translateError]);

  useEffect(() => {
    void load();
  }, [load]);

  if (isLoading && !rows) {
    return <Skeleton className="h-48 w-full" />;
  }

  if (error) {
    return (
      <div
        role="alert"
        className="bg-destructive/10 text-destructive border-destructive/20 space-y-3 rounded-lg border px-4 py-3 text-sm"
      >
        <p>{error}</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw className="size-4" aria-hidden />
          {t('retry')}
        </Button>
      </div>
    );
  }

  // One branch is not a comparison — see the note above.
  if (!rows || rows.length < 2) return null;

  function openBranch(id: string) {
    writeBranchId(id);
    window.location.reload();
  }

  return (
    <section className="space-y-3" aria-labelledby="branch-summary-heading">
      <div>
        <h2 id="branch-summary-heading" className="text-sm font-medium">
          {t('title')}
        </h2>
        <p className="text-muted-foreground mt-1 text-xs">{t('subtitle')}</p>
      </div>

      {/* The table scrolls on its own rather than the page: three numeric
          columns do not fit a phone, and a horizontally scrolling document
          would move the whole dashboard. */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th scope="col" className="px-4 py-2 text-start font-medium">
                {t('branch')}
              </th>
              <th scope="col" className="px-4 py-2 text-end font-medium">
                {t('revenue')}
              </th>
              <th scope="col" className="px-4 py-2 text-end font-medium">
                {t('orders')}
              </th>
              <th scope="col" className="px-4 py-2 text-end font-medium">
                {t('units')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-muted/40">
                <td className="px-4 py-2">
                  <button
                    type="button"
                    onClick={() => openBranch(row.id)}
                    className="hover:text-primary flex items-center gap-2 text-start underline-offset-4 hover:underline"
                  >
                    {row.isSellingPoint ? (
                      <Store className="size-4 shrink-0" aria-hidden />
                    ) : (
                      <Warehouse className="size-4 shrink-0" aria-hidden />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{row.name}</span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {row.businessName}
                      </span>
                    </span>
                  </button>
                </td>
                {/* Tabular numerals so columns of digits line up vertically. */}
                <td className="px-4 py-2 text-end font-medium tabular-nums">
                  {formatter.number(Number(row.revenue), 'currency')}
                </td>
                <td className="px-4 py-2 text-end tabular-nums">
                  {formatter.number(row.orderCount)}
                </td>
                <td className="px-4 py-2 text-end tabular-nums">
                  {formatter.number(row.unitsSold)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
