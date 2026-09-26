import { getTranslations, setRequestLocale } from 'next-intl/server';

import { PasswordRecoveryPanel } from '@/components/auth/password-recovery-panel';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { Link } from '@/i18n/navigation';
import { Reveal } from '@/components/motion/reveal';

/**
 * Where a locked-out person redeems the token an admin handed them, and where
 * an invited person activates their account. The heading is rendered by
 * `PasswordRecoveryPanel`, because which of the two it is comes from the URL
 * fragment and only the browser can read that.
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
            <PasswordRecoveryPanel />

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
