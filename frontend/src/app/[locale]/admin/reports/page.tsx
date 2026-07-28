import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ReportsView } from '@/components/reports/reports-view';

/**
 * Reports — the last section that was still a placeholder.
 *
 * Stays a Server Component so `setRequestLocale` keeps the shell statically
 * rendered; the fetching and the date range live in ReportsView.
 */
export default async function ReportsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('reports');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
      </div>

      <ReportsView />
    </div>
  );
}
