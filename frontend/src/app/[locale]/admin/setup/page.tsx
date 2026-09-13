import { setRequestLocale } from 'next-intl/server';
import { SetupWizard } from '@/components/setup/setup-wizard';

export default async function SetupPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <SetupWizard />;
}
