import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Breadcrumb } from '@/components/shell/breadcrumb';
import { ReportsView } from '@/components/reports/reports-view';

/**
 * The KPI/revenue analytics view — what "Reports" used to be before C3.1
 * split it into a catalogue (`/admin/reports`) linking out to individual
 * report pages. This is the first and most-used entry in that catalogue,
 * kept at its own route so existing bookmarks/links to detailed analytics
 * still resolve to the same content, just at `/overview` now.
 */
export default async function ReportsOverviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('reports');

  return (
    <div className="space-y-6">
      <Breadcrumb
        segments={[
          { label: t('catalogue.title'), href: '/admin/reports' },
          { label: t('title') },
        ]}
      />
      <div>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
      </div>

      <ReportsView />
    </div>
  );
}
