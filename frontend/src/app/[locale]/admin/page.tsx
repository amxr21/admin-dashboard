import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Reveal } from '@/components/motion/reveal';
import { RevenueChart, type RevenuePoint } from '@/components/dashboard/revenue-chart';
import { StatTile } from '@/components/dashboard/stat-tile';

/**
 * Dashboard overview.
 *
 * ─── SAMPLE DATA, CLEARLY MARKED ─────────────────────────────────────
 * The overview API endpoint does not exist yet — the backend has auth and
 * RBAC but no reporting routes. Rather than render an empty page, this uses
 * deterministic sample data so the layout, chart, formatting and RTL
 * behaviour are all reviewable now.
 *
 * Swap for a real fetch when GET /api/v1/reports/overview lands. The shapes
 * here (StatTileProps, RevenuePoint) are what that endpoint should return.
 */

/** Deterministic, not random — a chart that reshuffles every render is
 *  impossible to review and produces noisy screenshot diffs. */
function sampleRevenue(): RevenuePoint[] {
  const points: RevenuePoint[] = [];
  const start = new Date('2026-06-27T00:00:00Z');

  for (let day = 0; day < 30; day += 1) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + day);
    // A gentle wave plus drift — reads like real data without being random.
    const base = 4200 + Math.sin(day / 4) * 900 + day * 45;
    points.push({
      date: date.toISOString().slice(0, 10),
      revenue: Math.round(base),
    });
  }

  return points;
}

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('dashboard');
  const revenue = sampleRevenue();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>

      <Reveal>
        <section
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          aria-label={t('title')}
        >
          <StatTile
            labelKey="totalRevenue"
            value={148920}
            deltaPercent={12.4}
            format="currency"
            icon="revenue"
          />
          <StatTile
            labelKey="totalOrders"
            value={1284}
            deltaPercent={8.1}
            icon="orders"
          />
          <StatTile
            labelKey="totalCustomers"
            value={892}
            deltaPercent={3.2}
            icon="customers"
          />
          {/* invertDelta: a RISE in pending orders is bad, so the tile must not
              paint the increase green. */}
          <StatTile
            labelKey="pendingOrders"
            value={37}
            deltaPercent={5.6}
            invertDelta
            icon="pending"
          />
        </section>
      </Reveal>

      <Reveal delay={0.08}>
        <RevenueChart data={revenue} />
      </Reveal>
    </div>
  );
}
