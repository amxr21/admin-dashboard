import { getTranslations, setRequestLocale } from 'next-intl/server';

import { SaleScreen } from '@/components/pos/sale-screen';

/**
 * The till (O5.5).
 *
 * Server Component so `setRequestLocale` keeps the shell statically rendered;
 * the scanning, the cart and the checkout all live in `SaleScreen`.
 */
export default async function PosPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('pos');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
      </div>

      <SaleScreen />
    </div>
  );
}
