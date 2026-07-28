import { getTranslations, setRequestLocale } from 'next-intl/server';

import { DashboardOverview } from '@/components/dashboard/dashboard-overview';

/**
 * The dashboard.
 *
 * ─── THIS PAGE USED TO INVENT ITS OWN NUMBERS ────────────────────────
 * It rendered `sampleRevenue()` — a sine wave — because no reporting endpoint
 * existed. The source said so, but the RENDERED PAGE did not, so anyone
 * demoing the dashboard was showing fabricated revenue as though it were real.
 *
 * `GET /api/v1/reports/overview` and `/reports/revenue` exist now, and
 * DashboardOverview reads them.
 *
 * Stays a Server Component so `setRequestLocale` keeps the shell statically
 * rendered; the fetch lives in the client component because the token does.
 */
export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('dashboard');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <DashboardOverview />
    </div>
  );
}
