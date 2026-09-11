import { LifeBuoy } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { Link } from '@/i18n/navigation';
import { Reveal } from '@/components/motion/reveal';

/**
 * Where someone with no admin to ask requests their own reset code.
 *
 * A SEPARATE page from /reset-password rather than a second panel on it: the
 * two steps are minutes-to-days apart (ask here, read the email, redeem
 * there), and a token arriving by mail must have a stable address to be
 * redeemed at. Same unauthenticated chrome as /login and /reset-password —
 * locale and theme before sign-in, because someone who cannot read the form
 * cannot sign in to change the setting.
 */
export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('auth.forgot');

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
              {/* Symmetric — never .icon-directional. */}
              <span className="bg-primary text-primary-foreground mb-4 flex size-12 items-center justify-center rounded-xl">
                <LifeBuoy className="size-6" aria-hidden />
              </span>
              <h1 className="text-xl font-semibold">{t('title')}</h1>
              <p className="text-muted-foreground mt-1 text-sm">{t('subtitle')}</p>
            </div>

            <ForgotPasswordForm />

            <p className="text-muted-foreground mt-4 text-center text-sm">
              <Link
                href="/reset-password"
                className="hover:text-foreground underline underline-offset-4"
              >
                {t('haveCode')}
              </Link>
            </p>

            <p className="text-muted-foreground mt-2 text-center text-sm">
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
