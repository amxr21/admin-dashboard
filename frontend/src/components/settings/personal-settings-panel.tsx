import { useTranslations } from 'next-intl';
import { User } from 'lucide-react';

import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeToggle } from '@/components/theme-toggle';

/**
 * "Your preferences" — language and theme. Unlike every other settings
 * section, these affect only the person looking at the screen and take effect
 * immediately, with nothing to save — so this section has no fields, no fetch,
 * no dirty state.
 *
 * Rendered as the FIRST stacked section of the settings page, with the same
 * header shape (icon + title + description) and the same 2-column card grid as
 * every server-backed section below it, so personal and store settings read as
 * one continuous page rather than a separately-styled block bolted on top.
 */
export function PersonalSettingsPanel() {
  const t = useTranslations('settings');

  return (
    <section aria-labelledby="settings-group-personal" className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <User className="text-primary size-5" aria-hidden="true" />
          <h2 id="settings-group-personal" className="text-lg font-semibold tracking-tight">
            {t('personal.title')}
          </h2>
        </div>
        <p className="text-muted-foreground text-sm">{t('personal.description')}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="bg-card/50 flex items-center justify-between gap-3 rounded-lg border p-4">
          <span className="text-sm font-medium">{t('personal.language')}</span>
          <LocaleSwitcher />
        </div>

        <div className="bg-card/50 flex items-center justify-between gap-3 rounded-lg border p-4">
          <span className="text-sm font-medium">{t('personal.theme')}</span>
          <ThemeToggle />
        </div>
      </div>
    </section>
  );
}
