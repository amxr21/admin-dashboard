import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ProductsTable } from '@/components/products/products-table';

/**
 * Product catalogue.
 *
 * Stays a Server Component so `setRequestLocale` can keep the shell
 * statically rendered; all the fetching and interaction lives in
 * ProductsTable, which is the only part that needs to be a client component.
 */
export default async function ProductsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('products');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
      </div>

      <ProductsTable />
    </div>
  );
}
