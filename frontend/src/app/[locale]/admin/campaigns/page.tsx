import { getTranslations, setRequestLocale } from 'next-intl/server';

import { CampaignsWorkspace } from '@/components/campaigns/campaigns-workspace';
import { NavLabelHeading } from '@/components/shell/nav-label-heading';

export default async function CampaignsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('campaigns');
  return (
    <div className="space-y-6">
      <div>
        <NavLabelHeading labelKey="campaigns" defaultTitle={t('title')} />
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
      </div>
      <CampaignsWorkspace />
    </div>
  );
}