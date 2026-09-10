import { setRequestLocale } from 'next-intl/server';
import { OrganizationSettings } from '@/components/settings/organization-settings';

export default async function OrganizationPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <OrganizationSettings />;
}
