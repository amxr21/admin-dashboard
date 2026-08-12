import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Breadcrumb } from '@/components/shell/breadcrumb';
import { CourierPerformanceView } from '@/components/reports/courier-performance-view';

export default async function CourierPerformancePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('reports');
  const tReport = await getTranslations('reports.courierPerformance');

  return (
    <div className="space-y-6">
      <Breadcrumb
        segments={[
          { label: t('catalogue.title'), href: '/admin/reports' },
          { label: tReport('title') },
        ]}
      />
      <div>
        <h1 className="text-2xl font-semibold">{tReport('title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{tReport('subtitle')}</p>
      </div>

      <CourierPerformanceView />
    </div>
  );
}
