import { getTranslations, setRequestLocale } from 'next-intl/server';

import { InventoryTable } from '@/components/inventory/inventory-table';

/**
 * Inventory.
 *
 * Stays a Server Component so `setRequestLocale` keeps the shell statically
 * rendered; the fetching and the two sheets live in InventoryTable, which is
 * the only part that needs to be a client component.
 */
export default async function InventoryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('inventory');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
      </div>

      <InventoryTable />
    </div>
  );
}
