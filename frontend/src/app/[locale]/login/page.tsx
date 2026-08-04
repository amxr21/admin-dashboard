import { Lock } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { LoginForm } from '@/components/auth/login-form';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { Reveal } from '@/components/motion/reveal';

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('auth');

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Language and theme available BEFORE sign-in: someone who cannot read
          the form cannot sign in to change the setting. */}
      <div className="flex justify-end gap-1 p-4">
        <LocaleSwitcher />
        <ThemeToggle />
      </div>

      <div className="flex flex-1 items-center justify-center p-4">
        <Reveal>
          <div className="bg-card w-full max-w-sm rounded-lg border p-6 shadow-sm">
            <div className="mb-6 flex flex-col items-center text-center">
              {/* A padlock is symmetric — never .icon-directional. */}
              <span className="bg-primary text-primary-foreground mb-4 flex size-12 items-center justify-center rounded-xl">
                <Lock className="size-6" aria-hidden />
              </span>
              <h1 className="text-xl font-semibold">{t('title')}</h1>
              <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
            </div>
            <LoginForm />
          </div>
        </Reveal>
      </div>
    </div>
  );
}
