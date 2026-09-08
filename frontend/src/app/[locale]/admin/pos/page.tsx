import { getTranslations, setRequestLocale } from 'next-intl/server';

import { TillGate } from '@/components/pos/till-gate';

/**
 * The till (O5.5).
 *
 * Server Component so `setRequestLocale` keeps the shell statically rendered;
 * the scanning, the cart and the checkout all live in `SaleScreen`, reached
 * through `TillGate`'s onboarding step (owner's note, 2026-09-09: not an
 * instant render — a deliberate "ready to start your shift?" screen first).
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

      <TillGate />
    </div>
  );
}
