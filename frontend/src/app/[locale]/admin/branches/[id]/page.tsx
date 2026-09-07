import { getTranslations, setRequestLocale } from 'next-intl/server';

import { BusinessForm } from '@/components/branches/business-form';

/** Edit a business. */
export default async function EditBusinessPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('branches.business');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('editTitle')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('editSubtitle')}</p>
      </div>

      <BusinessForm businessId={id} />
    </div>
  );
}
