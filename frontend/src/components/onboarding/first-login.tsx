'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { Laptop, Moon, Sun } from 'lucide-react';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAppSettings } from '@/components/providers/settings-provider';
import { useAuth, useOptionalAuth } from '@/hooks/useAuth';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { usePathname, useRouter } from '@/i18n/navigation';
import { LOCALES, type Locale } from '@/i18n/routing';
import { markOnboarded, updateOwnProfile } from '@/lib/auth-api';
import { cn } from '@/lib/utils';

/**
 * First sign-in, for everyone: a short "your profile" welcome (name, language,
 * light or dark). Then, for an OWNER whose store has never been set up, the
 * setup wizard, which now ends with the store's look & feel.
 *
 * Shown when the server says `onboardedAt` is null. Existing accounts were
 * backfilled by the migration, so only people created from now on see it.
 * Finishing or skipping records it, so it never shows twice on any device.
 */

const THEMES = [
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
  { value: 'system', icon: Laptop },
] as const;

/** Once per tab session, so an owner who leaves the wizard isn't bounced back on every dashboard visit. */
const SETUP_REDIRECT_KEY = 'onboarding.setupOpened';

export function FirstLogin({ isPreviewing }: { isPreviewing: boolean }) {
  const user = useOptionalAuth()?.user;
  const settings = useAppSettings();
  const router = useRouter();
  const pathname = usePathname();
  const [welcomeDone, setWelcomeDone] = useState(false);

  const needsWelcome = !isPreviewing && user?.onboardedAt === null && !welcomeDone;

  useEffect(() => {
    if (needsWelcome || isPreviewing || user?.role !== 'OWNER' || settings.isLoading) return;
    if (settings.setupCompletedAt || settings.setupSkippedAt || pathname !== '/admin') return;
    try {
      if (window.sessionStorage.getItem(SETUP_REDIRECT_KEY)) return;
      window.sessionStorage.setItem(SETUP_REDIRECT_KEY, '1');
    } catch {
      // No session storage: still open the wizard once for this render.
    }
    router.push('/admin/setup');
  }, [needsWelcome, isPreviewing, user?.role, settings.isLoading, settings.setupCompletedAt, settings.setupSkippedAt, pathname, router]);

  if (!needsWelcome || !user) return null;
  return <WelcomeDialog initialName={user.name ?? ''} onDone={() => setWelcomeDone(true)} />;
}

function WelcomeDialog({ initialName, onDone }: { initialName: string; onDone: () => void }) {
  const t = useTranslations('firstLogin');
  const tLanguage = useTranslations('language');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { updateCachedUser } = useAuth();
  const translateError = useTranslatedApiError();
  const [name, setName] = useState(initialName);
  const [language, setLanguage] = useState<Locale>(locale);
  const [busy, setBusy] = useState(false);

  async function finish(save: boolean) {
    setBusy(true);
    try {
      const trimmed = name.trim();
      if (save && trimmed && trimmed !== initialName) {
        await updateOwnProfile({ name: trimmed });
        updateCachedUser({ name: trimmed });
      }
      await markOnboarded();
      updateCachedUser({ onboardedAt: new Date().toISOString() });
      onDone();
      if (save && language !== locale) router.replace(pathname, { locale: language });
    } catch (error) {
      toast.error(translateError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) void finish(false); }}>
      <DialogContent className="sm:max-w-lg">
        <div className="space-y-1.5">
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('intro')}</DialogDescription>
        </div>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="onboarding-name">{t('name')}</Label>
            <Input id="onboarding-name" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} autoComplete="name" />
          </div>

          <ChoiceRow label={t('language')} id="onboarding-language">
            {LOCALES.map((option) => (
              <Choice key={option} selected={language === option} onSelect={() => setLanguage(option)}>
                {tLanguage(option)}
              </Choice>
            ))}
          </ChoiceRow>

          <ChoiceRow label={t('theme')} id="onboarding-theme">
            {THEMES.map(({ value, icon: Icon }) => (
              <Choice key={value} selected={(theme ?? 'system') === value} onSelect={() => setTheme(value)}>
                <Icon className="size-4" aria-hidden />
                {t(`themes.${value}`)}
              </Choice>
            ))}
          </ChoiceRow>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => void finish(false)}>{t('skip')}</Button>
          <Button disabled={busy} onClick={() => void finish(true)}>{t('save')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ChoiceRow({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <p id={id} className="text-sm font-medium">{label}</p>
      <div role="radiogroup" aria-labelledby={id} className="grid grid-cols-3 gap-2">{children}</div>
    </div>
  );
}

function Choice({ selected, onSelect, children }: { selected: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'bg-card flex min-h-11 items-center justify-center gap-2 rounded-md border px-3 text-sm transition',
        selected ? 'border-primary ring-primary/30 ring-2' : 'hover:bg-muted/50',
      )}
    >
      {children}
    </button>
  );
}
