'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';

import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { readRecoveryFragment, type RecoveryFragment } from '@/lib/recovery-link';

/**
 * The ONE address for account recovery, holding both of its steps.
 *
 * ─── WHY ONE PAGE AND NOT TWO ────────────────────────────────────────
 * Asking for a code and redeeming one are the same task minutes or days
 * apart. Splitting them across two URLs means the code that arrives by email
 * points somewhere other than where it was requested, and someone who already
 * holds a code has to guess which of the two pages is theirs. Here, the
 * redemption form is always present and the request step sits above it —
 * whichever position you are in, the thing you need is on screen.
 *
 * The request step starts COLLAPSED because the majority case for this page
 * is someone who was handed a code and wants to type it. Opening it is one
 * click; hunting for the redemption form underneath an expanded form you do
 * not need is friction for everyone else.
 *
 * ─── ARRIVING FROM A LINK ────────────────────────────────────────────
 * Staff links carry the token in the fragment (see lib/recovery-link.ts).
 * It is read once, handed to the form, and stripped from the address bar so
 * the credential does not sit in history or get copied along with the URL.
 * An invite link (`invite=1`) is someone's FIRST visit: the page says
 * "activate your account" and drops the "email me a code" step they have no
 * use for. The heading lives here rather than in the server page because the
 * fragment only exists in the browser.
 */
export function PasswordRecoveryPanel() {
  const t = useTranslations('auth.forgot');
  const tReset = useTranslations('auth.reset');
  const [isRequesting, setIsRequesting] = useState(false);
  const [fromLink, setFromLink] = useState<RecoveryFragment | null>(null);

  useEffect(() => {
    const fragment = readRecoveryFragment(window.location.hash);
    if (!fragment) return;
    setFromLink(fragment);
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}`,
    );
  }, []);

  const invite = fromLink?.invite ?? false;

  return (
    <>
      <div className="mb-6 flex flex-col items-center text-center">
        {/* A key is symmetric — never .icon-directional. */}
        <span className="bg-primary text-primary-foreground mb-4 flex size-12 items-center justify-center rounded-xl">
          <KeyRound className="size-6" aria-hidden />
        </span>
        <h1 className="text-xl font-semibold">
          {invite ? tReset('activateTitle') : tReset('title')}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {invite ? tReset('activateSubtitle') : tReset('subtitle')}
        </p>
      </div>

      <div className="space-y-4">
        {invite ? null : isRequesting ? (
          <div className="space-y-3 rounded-md border p-4">
            <div>
              <h2 className="text-sm font-medium">{t('title')}</h2>
              <p className="text-muted-foreground mt-1 text-xs">{t('subtitle')}</p>
            </div>
            <ForgotPasswordForm />
          </div>
        ) : (
          <p className="text-muted-foreground text-center text-sm">
            {t('needCode')}{' '}
            <button
              type="button"
              onClick={() => setIsRequesting(true)}
              className="hover:text-foreground underline underline-offset-4"
            >
              {t('requestOne')}
            </button>
          </p>
        )}

        <ResetPasswordForm initialToken={fromLink?.token} invite={invite} />
      </div>
    </>
  );
}
