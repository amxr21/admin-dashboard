import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Reveal } from '@/components/motion/reveal';

/**
 * Dashboard index. A placeholder until group 9 builds the real KPI tiles and
 * charts — it exists now so the shell has something to frame and the nav's
 * active state can be verified.
 */
export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('nav');

  return (
    <Reveal>
      <h1 className="text-2xl font-semibold">{t('dashboard')}</h1>
    </Reveal>
  );
}
