import { getTranslations, setRequestLocale } from 'next-intl/server';

import { StaffTable } from '@/components/staff/staff-table';

/**
 * Staff — who has access, and how much of it.
 *
 * Stays a Server Component so `setRequestLocale` keeps the shell statically
 * rendered. Only OWNER and DEVELOPER reach this at all; the API refuses
 * everyone else regardless of what the nav shows.
 */
export default async function StaffPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('staff');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
      </div>

      <StaffTable />
    </div>
  );
}
