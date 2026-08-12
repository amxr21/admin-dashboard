import { getTranslations, setRequestLocale } from 'next-intl/server';

import { NavLabelHeading } from '@/components/shell/nav-label-heading';
import { OrdersTable } from '@/components/orders/orders-table';

/**
 * Orders.
 *
 * Stays a Server Component so `setRequestLocale` keeps the shell statically
 * rendered; all fetching and interaction lives in OrdersTable, which is the
 * only part that needs to be a client component.
 */
export default async function OrdersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('orders');

  return (
    <div className="space-y-6">
      <div>
        <NavLabelHeading labelKey="orders" defaultTitle={t('title')} />
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
      </div>

      <OrdersTable />
    </div>
  );
}
