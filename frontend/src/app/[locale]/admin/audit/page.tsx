import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AuditTable } from '@/components/audit/audit-table';

/**
 * The audit trail — who changed what.
 *
 * Stays a Server Component so `setRequestLocale` keeps the shell statically
 * rendered. Gated on the `staff` area, same as the Staff page: the API
 * refuses everyone else regardless of what the nav shows (see audit.route.ts
 * — it names people and what they did, closer to personnel data than to
 * business metrics).
 */
export default async function AuditPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('audit');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
      </div>

      <AuditTable />
    </div>
  );
}
