'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';

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
 */
export function PasswordRecoveryPanel() {
  const t = useTranslations('auth.forgot');
  const [isRequesting, setIsRequesting] = useState(false);

  return (
    <div className="space-y-4">
      {isRequesting ? (
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

      <ResetPasswordForm />
    </div>
  );
}
