import { Building2, User } from 'lucide-react';
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
 * language for the whole team, which it does not. Both are given the SAME card
 * treatment (icon + heading + description above a bordered body) so the page
 * reads as one designed surface rather than a stack of mismatched blocks.
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
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
      </div>

      <section className="bg-card overflow-hidden rounded-xl border">
        <div className="flex items-start gap-3 border-b p-4 sm:p-6">
          <User
            className="text-muted-foreground mt-0.5 size-5 shrink-0"
            aria-hidden="true"
          />
          <div>
            <h2 className="font-medium">{t('personal.title')}</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {t('personal.description')}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-8 gap-y-4 p-4 sm:p-6">
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

      <section className="bg-card overflow-hidden rounded-xl border">
        <div className="flex items-start gap-3 border-b p-4 sm:p-6">
          <Building2
            className="text-muted-foreground mt-0.5 size-5 shrink-0"
            aria-hidden="true"
          />
          <div>
            <h2 className="font-medium">{t('store.title')}</h2>
            <p className="text-muted-foreground mt-1 text-sm">{t('store.description')}</p>
          </div>
        </div>

        <div className="p-4 sm:p-6">
          <SettingsForm />
        </div>
      </section>
    </div>
  );
}
