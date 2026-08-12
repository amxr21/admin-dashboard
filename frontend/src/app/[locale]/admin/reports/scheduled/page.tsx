import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Breadcrumb } from '@/components/shell/breadcrumb';
import { ScheduledReportsList } from '@/components/reports/scheduled-reports-list';

export default async function ScheduledReportsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('reports');
  const tScheduled = await getTranslations('reports.scheduled');

  return (
    <div className="space-y-6">
      <Breadcrumb
        segments={[
          { label: t('catalogue.title'), href: '/admin/reports' },
          { label: tScheduled('title') },
        ]}
      />

      <ScheduledReportsList />
    </div>
  );
}
