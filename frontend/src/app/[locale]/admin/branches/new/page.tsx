import { getTranslations, setRequestLocale } from 'next-intl/server';

import { BusinessForm } from '@/components/branches/business-form';

/** Create a business — a full page, per the drawer-vs-page convention. */
export default async function NewBusinessPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('branches.business');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('createTitle')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('createSubtitle')}</p>
      </div>

      <BusinessForm />
    </div>
  );
}
