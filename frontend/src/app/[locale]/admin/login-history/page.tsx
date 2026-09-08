import { getTranslations, setRequestLocale } from 'next-intl/server';

import { StaffActivityView } from '@/components/staff/staff-activity-view';

/**
 * Staff activity — who is on now, who worked when, and who got in.
 *
 * F6.5: shifts share this page rather than getting their own. Both answer
 * "what have staff been doing", both are guarded by `staff`, and both are
 * read by the same person at the same moment — two near-identical pages
 * would mean whoever is looking has to already know which holds the answer.
 *
 * Gated on the `staff` area, same as Audit and Staff: it names who has been
 * failing to sign in, which is closer to personnel data than to business
 * metrics. The API refuses everyone else regardless of what the nav shows.
 *
 * Separate from `/admin/audit` on purpose rather than being a saved filter
 * there. The audit trail answers "what changed"; this answers "who is getting
 * in", which is a different question asked by a different person at a
 * different time — and a filter preset is not discoverable by anyone who does
 * not already know the events exist. Which, before this page, nobody did.
 */
export default async function LoginHistoryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('staffActivity');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
      </div>

      <StaffActivityView />
    </div>
  );
}
