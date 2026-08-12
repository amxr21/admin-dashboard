import { getTranslations, setRequestLocale } from 'next-intl/server';

import { NavLabelHeading } from '@/components/shell/nav-label-heading';
import { ReturnsTable } from '@/components/returns/returns-table';

/**
 * Returns / RMA queue.
 *
 * Stays a Server Component so `setRequestLocale` keeps the shell statically
 * rendered; all fetching and interaction lives in ReturnsTable.
 */
export default async function ReturnsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('returns');

  return (
    <div className="space-y-6">
      <div>
        <NavLabelHeading labelKey="returns" defaultTitle={t('title')} />
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
      </div>

      <ReturnsTable />
    </div>
  );
}
