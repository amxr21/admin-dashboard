import { Truck } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { CourierLoginForm } from '@/components/courier/courier-login-form';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { Reveal } from '@/components/motion/reveal';

/**
 * Courier sign-in — a separate auth surface from `/login` (staff). Lives
 * outside `/admin` on purpose: it must never inherit the admin shell
 * (sidebar, staff session guard) meant for a completely different kind of
 * user. See `courier-auth.service.ts` for why the tokens can't cross.
 */
export default async function CourierLoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('courier');

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex justify-end gap-1 p-4">
        <LocaleSwitcher />
        <ThemeToggle />
      </div>

      <div className="flex flex-1 items-center justify-center p-4">
        <Reveal>
          <div className="bg-card w-full max-w-sm rounded-lg border p-6 shadow-sm">
            <div className="mb-6 flex flex-col items-center text-center">
              {/* A truck is directional in principle, but this is a static
                  badge icon, not a motion cue — left as-is like every other
                  badge/logo glyph in the app. */}
              <span className="bg-primary text-primary-foreground mb-4 flex size-12 items-center justify-center rounded-xl">
                <Truck className="size-6" aria-hidden />
              </span>
              <h1 className="text-xl font-semibold">{t('login.title')}</h1>
              <p className="text-muted-foreground mt-1 text-sm">{t('login.subtitle')}</p>
            </div>
            <CourierLoginForm />
          </div>
        </Reveal>
      </div>
    </div>
  );
}
