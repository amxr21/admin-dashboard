import { setRequestLocale } from 'next-intl/server';

import { SectionPlaceholder } from '@/components/shell/section-placeholder';

/**
 * Settings — planned, not yet implemented.
 *
 * A real page rather than a missing route: the nav advertises this section, so
 * a 404 here would read as a broken app instead of an unfinished one.
 */
export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <SectionPlaceholder section="settings" />
  );
}
