import { KeyRound } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { Link } from '@/i18n/navigation';
import { Reveal } from '@/components/motion/reveal';

/**
 * Where a locked-out person redeems the token an admin handed them.
 *
 * Deliberately outside the admin shell and unauthenticated — the whole point is
 * that the user cannot sign in yet. Same chrome as /login (locale + theme
 * before sign-in) for the same reason: someone who cannot read the form cannot
 * sign in to change the setting.
 */
export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('auth.reset');

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
              {/* A key is symmetric — never .icon-directional. */}
              <span className="bg-primary text-primary-foreground mb-4 flex size-12 items-center justify-center rounded-xl">
                <KeyRound className="size-6" aria-hidden />
              </span>
              <h1 className="text-xl font-semibold">{t('title')}</h1>
              <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
            </div>

            <ResetPasswordForm />

            <p className="text-muted-foreground mt-4 text-center text-sm">
              <Link href="/login" className="hover:text-foreground underline underline-offset-4">
                {t('backToLogin')}
              </Link>
            </p>
          </div>
        </Reveal>
      </div>
    </div>
  );
}
