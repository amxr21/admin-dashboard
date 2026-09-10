import { getTranslations, setRequestLocale } from 'next-intl/server';

import { SuppliersTable } from '@/components/suppliers/suppliers-table';

export default async function SuppliersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('suppliers');
  return <div className="space-y-6"><header><h1 className="text-2xl font-semibold">{t('title')}</h1><p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p></header><SuppliersTable /></div>;
}
