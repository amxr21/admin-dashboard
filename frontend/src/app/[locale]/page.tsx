import { setRequestLocale } from 'next-intl/server';

import { redirect } from '@/i18n/navigation';

/**
 * The app has no public landing page — it is an internal tool, so the root
 * belongs to the dashboard.
 *
 * This replaces the temporary design-token reference page, whose job (proving
 * Tailwind was wired and letting both token tiers be eyeballed side by side)
 * ended the moment a real page existed.
 *
 * Signed-out users are NOT redirected here. `/admin` is wrapped in AuthGuard,
 * which bounces them to `/login` once the session check settles — putting the
 * decision in one place instead of two. Doing it here as well would need the
 * session, which lives in localStorage and is unreadable on the server.
 *
 * `redirect` comes from `@/i18n/navigation`, so an Arabic visitor lands on
 * `/ar/admin` rather than being silently switched to English.
 */
export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  redirect({ href: '/admin', locale });
}
