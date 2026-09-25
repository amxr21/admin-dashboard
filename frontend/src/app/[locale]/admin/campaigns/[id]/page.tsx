import { getTranslations, setRequestLocale } from 'next-intl/server';

import { CampaignDetail } from '@/components/campaigns/campaign-detail';
import { Breadcrumb } from '@/components/shell/breadcrumb';

export default async function CampaignPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('campaigns');
  return (
    <div className="space-y-6">
      <Breadcrumb segments={[{ label: t('title'), href: '/admin/campaigns' }, { label: t('detail.crumb') }]} />
      <CampaignDetail id={id} />
    </div>
  );
}