'use client';

import { useTranslations } from 'next-intl';

import { useAppSettings } from '@/components/providers/settings-provider';
import type { TillReport } from '@/lib/shifts-api';

/**
 * The X/Z report (O9 Tier 4) — printable, same shape whether the shift is
 * still open (X, `isFinal: false`) or closed (Z, `isFinal: true`). Reuses
 * `thermal-receipt.tsx`'s own print-scoping technique: styling scoped to
 * THIS component rather than globals.css, since the page size is a property
 * of one document, and a global rule would put every other print in the app
 * on a receipt roll.
 */
export function TillReportView({ report }: { report: TillReport }) {
  const t = useTranslations('shifts.report');
  const { storeName } = useAppSettings();

  const { shift } = report;

  return (
    <>
      <style>{`
        @media print {
          @page { size: 80mm auto; margin: 3mm; }
          body * { visibility: hidden; }
          #till-report, #till-report * { visibility: visible; }
          #till-report { position: absolute; inset-inline-start: 0; top: 0; width: 100%; }
        }
      `}</style>

      <div
        id="till-report"
        className="force-ltr space-y-2 text-start font-mono text-xs"
      >
        <div className="text-center">
          {storeName ? <p className="font-semibold">{storeName}</p> : null}
          <p className="font-semibold">{report.isFinal ? t('zTitle') : t('xTitle')}</p>
          <p>{shift.branch.name}</p>
        </div>

        <div className="border-t border-dashed pt-2">
          <div className="flex justify-between">
            <span>{t('cashier')}</span>
            <span>{shift.user.name ?? shift.user.email}</span>
          </div>
          <div className="flex justify-between">
            <span>{t('started')}</span>
            <span>{new Date(shift.startedAt).toLocaleString()}</span>
          </div>
          {shift.endedAt ? (
            <div className="flex justify-between">
              <span>{t('ended')}</span>
              <span>{new Date(shift.endedAt).toLocaleString()}</span>
            </div>
          ) : null}
        </div>

        <div className="border-t border-dashed pt-2">
          <p className="font-semibold">{t('salesByMethod')}</p>
          {report.byMethod.length === 0 ? (
            <p className="text-muted-foreground">{t('noSales')}</p>
          ) : (
            report.byMethod.map((row) => (
              <div key={row.method} className="flex justify-between">
                <span>{row.method}</span>
                <span className="tabular-nums">{row.total}</span>
              </div>
            ))
          )}
        </div>

        {shift.openingFloat !== null ? (
          <div className="border-t border-dashed pt-2">
            <div className="flex justify-between">
              <span>{t('openingFloat')}</span>
              <span className="tabular-nums">{shift.openingFloat}</span>
            </div>
            <div className="flex justify-between">
              <span>{t('cashSales')}</span>
              <span className="tabular-nums">{report.cash}</span>
            </div>
            <div className="flex justify-between">
              <span>{t('cashDrops')}</span>
              <span className="tabular-nums">-{report.cashDropTotal}</span>
            </div>
            <div className="flex justify-between">
              <span>{t('payouts')}</span>
              <span className="tabular-nums">-{report.payoutTotal}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>{t('expectedInDrawer')}</span>
              <span className="tabular-nums">{report.expectedCash}</span>
            </div>

            {shift.closingCount !== null ? (
              <>
                <div className="flex justify-between">
                  <span>{t('counted')}</span>
                  <span className="tabular-nums">{shift.closingCount}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>{t('variance')}</span>
                  <span className="tabular-nums">{shift.variance}</span>
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {/*
          URG-034 — foreign cash, counted per currency in its OWN units.

          Deliberately OUTSIDE the `openingFloat` block above: that group is
          the base-currency drawer reconciliation, and a till opened without a
          float would otherwise hide foreign notes that are physically sitting
          in the drawer.

          Never summed into one figure, and never converted: the owner's rule
          is that a genuine shortfall must stay distinguishable from the rate
          having moved during the shift, and a combined total makes those two
          indistinguishable. Each row is "what should still be here, in this
          currency" — taken minus change given back.
        */}
        {report.byTenderCurrency.length > 0 ? (
          <div className="border-t border-dashed pt-2">
            <p className="font-semibold">{t('foreignCash')}</p>
            {report.byTenderCurrency.map((row) => (
              <div key={row.currency} className="flex justify-between">
                <span>{row.currency}</span>
                <span className="tabular-nums">{row.expected}</span>
              </div>
            ))}
            <p className="text-muted-foreground mt-1">{t('foreignCashHint')}</p>
          </div>
        ) : null}

        {report.noSaleCount > 0 ? (
          <div className="flex justify-between border-t border-dashed pt-2">
            <span>{t('noSaleOpens')}</span>
            <span className="tabular-nums">{report.noSaleCount}</span>
          </div>
        ) : null}

        <p className="text-muted-foreground border-t border-dashed pt-2 text-center">
          {t('printedAt', { time: new Date().toLocaleString() })}
        </p>
      </div>
    </>
  );
}
