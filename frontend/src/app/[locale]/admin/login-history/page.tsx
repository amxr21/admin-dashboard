import { getTranslations, setRequestLocale } from 'next-intl/server';

import { LoginHistoryTable } from '@/components/staff/login-history-table';

/**
 * Sign-in history — who got in, who did not, and from where.
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

  const t = await getTranslations('loginHistory');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
      </div>

      <LoginHistoryTable />
    </div>
  );
}
