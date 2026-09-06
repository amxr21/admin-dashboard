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
      {/*
        * F7.3 — this used `t('title')`, which is `reports.title` ("Reports"),
        * so the trail read "Reports > Reports" and the heading repeated the
        * section name. Both now name the REPORT — `reports.overview.title`
        * ("Revenue overview") — which is what tells a reader this is one
        * report among several rather than the section landing page.
        */}
      <Breadcrumb
        segments={[
          { label: t('catalogue.title'), href: '/admin/reports' },
          { label: t('overview.title') },
        ]}
      />
      <div>
        <h1 className="text-2xl font-semibold">{t('overview.title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('overview.description')}</p>
      </div>

      <ReportsView />
    </div>
  );
}
