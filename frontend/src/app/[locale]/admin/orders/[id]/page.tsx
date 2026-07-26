import { setRequestLocale } from 'next-intl/server';

import { OrderDetail } from '@/components/orders/order-detail';

/**
 * One order.
 *
 * Not statically generated — there is no fixed set of order ids, and the
 * status changes while people are looking at it.
 */
export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  return <OrderDetail id={id} />;
}
