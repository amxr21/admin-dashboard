'use client';

import { useTranslations } from 'next-intl';

import { useAppSettings } from '@/components/providers/settings-provider';

/**
 * A till receipt (O5.9).
 *
 * ─── WHY THIS IS NOT THE INVOICE ─────────────────────────────────────
 * The invoice is an A4 document with a letterhead, an address block and a
 * table. A receipt is 58 or 80mm of paper with no horizontal room for any of
 * that: at 58mm you get roughly 32 monospace characters per line. Restyling
 * the invoice to fit would mean hiding most of it and hoping the rest
 * reflows; this is a different document that happens to describe the same
 * sale.
 *
 * ─── THE WIDTH IS A REAL PAGE SIZE, NOT A CSS GUESS ──────────────────
 * `@page { size: 58mm auto }` tells the printer the roll's width and lets the
 * height run to whatever the content needs. Thermal printers feed continuous
 * paper — giving them a fixed page height would either cut a long receipt off
 * or eject blank paper after a short one.
 *
 * ─── MONOSPACE, AND ALIGNED BY COLUMN ────────────────────────────────
 * Prices line up only if the digits do. This is the one place in the app
 * where a monospace face is not a stylistic choice.
 */

export interface ReceiptLine {
  name: string;
  quantity: number;
  /** Unit price, 2dp string. */
  price: string;
}

export interface ReceiptData {
  orderNumber: string;
  soldAt: string;
  lines: ReceiptLine[];
  subtotal: string;
  taxAmount: string;
  total: string;
  method: string;
  tendered: string | null;
  change: string | null;
  cashier?: string | undefined;
}

/** 58mm is the common small roll; 80mm is the wider one. */
export type ReceiptWidth = '58mm' | '80mm';

export function ThermalReceipt({
  data,
  width = '80mm',
}: {
  data: ReceiptData;
  width?: ReceiptWidth;
}) {
  const t = useTranslations('pos.receipt');
  const { storeName, storeAddress, storeSupportPhone, storeTaxId } = useAppSettings();

  return (
    <>
      {/*
        Scoped to this component rather than globals.css: the page SIZE is a
        property of this one document, and setting it globally would make
        every other print in the app come out on a paper roll.
      */}
      <style>{`
        @media print {
          @page { size: ${width} auto; margin: 3mm; }
          body * { visibility: hidden; }
          #thermal-receipt, #thermal-receipt * { visibility: visible; }
          #thermal-receipt { position: absolute; inset-inline-start: 0; top: 0; width: 100%; }
        }
      `}</style>

      <div
        id="thermal-receipt"
        // `force-ltr` even in Arabic: the layout is a column of aligned
        // figures, and a right-to-left flip would put the currency on the
        // wrong side of the digits on a printer that cannot reflow.
        className="force-ltr mx-auto bg-white p-3 font-mono text-[11px] leading-tight text-black"
        style={{ maxWidth: width === '58mm' ? '58mm' : '80mm' }}
      >
        <div className="text-center">
          {storeName ? <p className="text-[13px] font-bold">{storeName}</p> : null}
          {storeAddress ? <p>{storeAddress}</p> : null}
          {storeSupportPhone ? <p>{storeSupportPhone}</p> : null}
          {/* Printed only when recorded — a receipt claiming a blank tax id
              is worse than one that simply omits the line. */}
          {storeTaxId ? <p>{t('taxId', { id: storeTaxId })}</p> : null}
        </div>

        <hr className="my-2 border-dashed border-black" />

        <div className="flex justify-between">
          <span>{data.orderNumber}</span>
          <span>{data.soldAt}</span>
        </div>
        {data.cashier ? <p>{t('servedBy', { name: data.cashier })}</p> : null}

        <hr className="my-2 border-dashed border-black" />

        <table className="w-full">
          <tbody>
            {data.lines.map((line, index) => (
              // Index as key: a receipt is rendered once from a frozen sale
              // and never reordered, so there is no identity to preserve.
              <tr key={index} className="align-top">
                <td className="pe-1">
                  {line.quantity}× {line.name}
                </td>
                <td className="text-end whitespace-nowrap tabular-nums">
                  {(Number(line.price) * line.quantity).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <hr className="my-2 border-dashed border-black" />

        <table className="w-full tabular-nums">
          <tbody>
            <tr>
              <td>{t('subtotal')}</td>
              <td className="text-end">{data.subtotal}</td>
            </tr>
            <tr>
              <td>{t('tax')}</td>
              <td className="text-end">{data.taxAmount}</td>
            </tr>
            <tr className="text-[13px] font-bold">
              <td>{t('total')}</td>
              <td className="text-end">{data.total}</td>
            </tr>
            <tr>
              <td>{t('paidBy')}</td>
              <td className="text-end">{data.method}</td>
            </tr>
            {/* Cash only. On a card sale nothing was tendered and nothing came
                back, and printing "0.00" would read as a mistake. */}
            {data.tendered !== null ? (
              <tr>
                <td>{t('tendered')}</td>
                <td className="text-end">{data.tendered}</td>
              </tr>
            ) : null}
            {data.change !== null ? (
              <tr>
                <td>{t('change')}</td>
                <td className="text-end">{data.change}</td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <hr className="my-2 border-dashed border-black" />

        <p className="text-center">{t('thanks')}</p>
      </div>
    </>
  );
}
