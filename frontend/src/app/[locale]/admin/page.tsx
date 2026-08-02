import { getTranslations, setRequestLocale } from 'next-intl/server';

import { DashboardOverview } from '@/components/dashboard/dashboard-overview';
import { PageTitle } from '@/components/shell/page-title';

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
    <>
      {/* Title lives in the top bar now (Phase 2) — the subtitle ("A snapshot
          of revenue…") described what a dashboard is and cost a permanent
          row for it; removed entirely rather than moved, so the first data
          pixel sits directly under one compact control band. */}
      <PageTitle title={t('title')} />
      <DashboardOverview />
    </>
  );
}
