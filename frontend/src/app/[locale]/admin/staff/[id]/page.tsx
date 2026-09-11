import { setRequestLocale } from 'next-intl/server';

import { StaffDetailView } from '@/components/staff/staff-detail-view';

export default async function StaffDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  return <StaffDetailView staffId={id} />;
}
