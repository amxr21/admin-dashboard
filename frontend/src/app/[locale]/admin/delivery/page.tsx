import { getTranslations, setRequestLocale } from 'next-intl/server';

import { CouriersTable } from '@/components/delivery/couriers-table';

/**
 * Delivery — couriers and their access credentials.
 *
 * Stays a Server Component so `setRequestLocale` keeps the shell statically
 * rendered; the fetching, the sheet and the one-time code panel live in
 * CouriersTable.
 */
export default async function DeliveryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('delivery');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
      </div>

      <CouriersTable />
    </div>
  );
}
