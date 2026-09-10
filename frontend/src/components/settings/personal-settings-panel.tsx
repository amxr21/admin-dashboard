'use client';

import { useTranslations } from 'next-intl';
import { Sparkles, User } from 'lucide-react';

import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { useMotion } from '@/components/motion-provider';
import { Button } from '@/components/ui/button';

/**
 * "Your preferences" — language, theme and motion. Unlike every other settings
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
  const tMotion = useTranslations('motion');
  const { motionEnabled, setMotionEnabled, ready } = useMotion();

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

        <div className="bg-card/50 flex items-center justify-between gap-3 rounded-lg border p-4">
          <span className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="text-primary size-4" aria-hidden="true" />
            {tMotion('label')}
          </span>
          <Button
            type="button"
            variant="outline"
            aria-pressed={motionEnabled}
            disabled={!ready}
            onClick={() => setMotionEnabled(!motionEnabled)}
          >
            {motionEnabled ? tMotion('disable') : tMotion('enable')}
          </Button>
        </div>
      </div>
    </section>
  );
}
