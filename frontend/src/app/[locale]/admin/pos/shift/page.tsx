import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ShiftClockScreen } from '@/components/pos/shift-clock-screen';

/**
 * The shift clock's own page (owner's note, 2026-09-09): "shift can be set
 * in a separate tab for cashiers in their view, smth like an interactive
 * clock." Previously the only way to clock on/off was a small control in the
 * topbar — this gives it the room a real clock deserves and doubles as
 * where the till's own onboarding gate sends a cashier who is not yet on
 * shift (see `sale-screen.tsx`'s gate).
 *
 * Server Component so `setRequestLocale` keeps the shell statically
 * rendered; the clock itself lives in `ShiftClockScreen`.
 */
export default async function ShiftPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('shifts');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('pageTitle')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('pageSubtitle')}</p>
      </div>

      <ShiftClockScreen />
    </div>
  );
}
