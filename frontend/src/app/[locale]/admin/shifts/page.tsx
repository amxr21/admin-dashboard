import { getTranslations, setRequestLocale } from 'next-intl/server';

import { NavLabelHeading } from '@/components/shell/nav-label-heading';
import { ShiftApprovalQueue } from '@/components/staff/shift-approval-queue';

/**
 * A manager's shift-approval queue (O9.19).
 *
 * Stays a Server Component so `setRequestLocale` keeps the shell statically
 * rendered. Behind the `shifts` area — MANAGER and above, not `staff` — the
 * API refuses everyone else regardless of what the nav shows.
 */
export default async function ShiftsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('shifts.approval');

  return (
    <div className="space-y-6">
      <div>
        <NavLabelHeading labelKey="shifts" defaultTitle={t('title')} />
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
      </div>

      <ShiftApprovalQueue />
    </div>
  );
}
