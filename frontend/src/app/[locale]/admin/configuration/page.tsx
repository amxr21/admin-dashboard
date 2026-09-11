import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ConfigurationView } from '@/components/diagnostics/configuration-view';

/**
 * Configuration reference — the owner's own list of what this deployment
 * needs set up, and what is actually set right now.
 *
 * Stays a Server Component so `setRequestLocale` keeps the shell statically
 * rendered. DEVELOPER-only, enforced by `GET /diagnostics/configuration`
 * (`requireRole(DEVELOPER)`) rather than here: the API refuses everyone else
 * regardless of what the nav shows, which is the only check that matters —
 * hiding a link is presentation, not authorization.
 */
export default async function ConfigurationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('diagnostics.configuration');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
      </div>

      <ConfigurationView />
    </div>
  );
}
