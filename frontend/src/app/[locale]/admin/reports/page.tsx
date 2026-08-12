import { getTranslations, setRequestLocale } from 'next-intl/server';

import { NavLabelHeading } from '@/components/shell/nav-label-heading';
import { ReportCatalogue } from '@/components/reports/report-catalogue';

/**
 * The report catalogue (C3.1) — every report grouped by domain, linking out
 * to its own page. Was the single revenue/KPI view before this session;
 * that content moved to `/admin/reports/overview`, the first entry here.
 */
export default async function ReportsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('reports.catalogue');

  return (
    <div className="space-y-6">
      <div>
        <NavLabelHeading labelKey="reports" defaultTitle={t('title')} />
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
      </div>

      <ReportCatalogue />
    </div>
  );
}
