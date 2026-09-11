import { getTranslations, setRequestLocale } from 'next-intl/server';

import { CustomerCasesWorkspace } from '@/components/customer-cases/customer-cases-workspace';
import { NavLabelHeading } from '@/components/shell/nav-label-heading';

export default async function CustomerCasesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('customerCases');
  return <div className="space-y-6"><div><NavLabelHeading labelKey="customerCases" defaultTitle={t('title')} /><p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p></div><CustomerCasesWorkspace /></div>;
}
