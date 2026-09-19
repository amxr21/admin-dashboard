import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ConfigurationView } from '@/components/diagnostics/configuration-view';
import { TranslationCompletenessPanel } from '@/components/settings/translation-completeness-panel';

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

      {/*
        English/Arabic key parity — moved off the settings page, where it was
        asking a shop owner to act on something only a developer can fix. It
        belongs with the other deployment-state readouts: same audience, same
        read-only nature, and the Arabic catalogue being unreviewed is still a
        real release blocker worth seeing here.

        A Server Component among client ones, which is fine — it reads both
        message catalogues at render time precisely so neither reaches the
        browser bundle.
      */}
      <TranslationCompletenessPanel />
    </div>
  );
}
