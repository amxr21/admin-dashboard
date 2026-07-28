import { getTranslations, setRequestLocale } from 'next-intl/server';

import { LocaleSwitcher } from '@/components/locale-switcher';
import { SettingsForm } from '@/components/settings/settings-form';
import { ThemeToggle } from '@/components/theme-toggle';

/**
 * Settings — personal preferences and store-wide configuration.
 *
 * ─── TWO SECTIONS, BECAUSE THEY ARE TWO DIFFERENT THINGS ─────────────
 * "Your preferences" affect only the person looking at the screen and take
 * effect immediately, with nothing to save. "Store settings" affect everyone
 * and are written to the database behind an explicit save.
 *
 * Putting them under one heading would imply the language switcher changes the
 * language for the whole team, which it does not.
 */
export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('settings');

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
      </div>

      <section className="bg-card space-y-4 rounded-lg border p-4">
        <div>
          <h2 className="font-medium">{t('personal.title')}</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {t('personal.description')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">{t('personal.language')}</span>
            <LocaleSwitcher />
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm font-medium">{t('personal.theme')}</span>
            <ThemeToggle />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="font-medium">{t('store.title')}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{t('store.description')}</p>
        </div>

        <SettingsForm />
      </section>
    </div>
  );
}
