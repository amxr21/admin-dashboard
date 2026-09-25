import { getTranslations, setRequestLocale } from 'next-intl/server';

import { CampaignEditor } from '@/components/campaigns/campaign-editor';
import { Breadcrumb } from '@/components/shell/breadcrumb';

export default async function NewCampaignPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('campaigns');
  return (
    <div className="space-y-6">
      <Breadcrumb segments={[{ label: t('title'), href: '/admin/campaigns' }, { label: t('new') }]} />
      <h1 className="text-2xl font-semibold">{t('new')}</h1>
      <CampaignEditor campaign={null} />
    </div>
  );
}