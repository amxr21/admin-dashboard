import { setRequestLocale } from 'next-intl/server';

import { CourierDashboard } from '@/components/courier/courier-dashboard';

/**
 * A courier's own assignments — the frontend half of the courier API
 * (backend-only until now; see CLAUDE.md's Delivery notes). Client-side
 * auth check only: `CourierDashboard` redirects to `/courier/login` itself
 * if no courier session is stored, mirroring how `AuthGuard` gates `/admin`
 * — this file stays a thin Server Component wrapper so `setRequestLocale`
 * keeps the shell statically rendered.
 */
export default async function CourierPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <CourierDashboard />;
}
