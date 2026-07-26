import { setRequestLocale } from 'next-intl/server';

import { OrderInvoice } from '@/components/orders/order-invoice';

/**
 * Printable invoice for one order.
 *
 * Its own route rather than a modal so it is linkable and printable on its
 * own; `@media print` in globals.css drops the dashboard chrome so only the
 * document reaches paper.
 */
export default async function OrderInvoicePage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  return <OrderInvoice id={id} />;
}
