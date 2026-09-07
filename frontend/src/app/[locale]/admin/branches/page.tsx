import { getTranslations, setRequestLocale } from 'next-intl/server';

import { BranchesView } from '@/components/branches/branches-view';

/**
 * Businesses and branches — the controls F8 never shipped.
 *
 * Server Component so `setRequestLocale` keeps the shell statically rendered;
 * the fetching, the sheet and the roster panel live in `BranchesView`.
 */
export default async function BranchesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('branches.manage');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
      </div>

      <BranchesView />
    </div>
  );
}
