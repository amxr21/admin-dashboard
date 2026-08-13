import { setRequestLocale } from 'next-intl/server';

import { CourierDetail } from '@/components/delivery/courier-detail';

/**
 * One courier — B4.5.
 *
 * Not statically generated — there is no fixed set of courier ids, and their
 * assignment history changes while someone is looking at it.
 */
export default async function CourierDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  return <CourierDetail id={id} />;
}
