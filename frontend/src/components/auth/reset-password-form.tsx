'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useRouter } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { redeemPasswordReset } from '@/lib/auth-api';

/**
 * Redeem an admin-issued reset token and choose a new password.
 *
 * ─── THE SERVER OWNS THE PASSWORD POLICY, NOT THIS FORM ──────────────
 * `security.minPasswordLength` is configurable and lives behind an
 * authenticated endpoint — which this page, by definition, cannot read: the
 * person using it cannot sign in. So there is deliberately NO client-side
 * length floor here. Hardcoding one would drift the moment an owner changed
 * the setting (exactly the bug that exists today in `staff-password-panel.tsx`
 * and `staff-sheet.tsx`, both of which assume 12), and it would drift toward
 * being WRONG — enabling the button for a password the server then rejects.
 * Instead the server's own 400 is surfaced verbatim.
 *
 * The only client-side check is that the two fields match, which is a typo
 * guard rather than a policy, and which the server cannot do for us because it
 * only ever receives one of them.
 *
 * ─── FAILURES ARE DELIBERATELY NOT DISAMBIGUATED ─────────────────────
 * The backend answers unknown, already-used, and expired tokens with the same
 * generic error on purpose — distinguishing them would let someone probe which
 * tokens exist. This form does not try to be more helpful than that.
 */
export function ResetPasswordForm() {
  const t = useTranslations('auth.reset');
  const tStates = useTranslations('states.error');
  const router = useRouter();

  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function messageFor(caught: unknown): string {
    if (!(caught instanceof ApiError)) return tStates('network');

    switch (caught.status) {
      case 400:
        // Covers both "token is not valid" and "password fails the policy".
        // The server's message is the only thing that knows which, and it is
        // already written for a human — pass it through rather than replacing
        // it with a vaguer guess.
        return caught.message;
      case 429:
        return t('rateLimited');
      default:
        return tStates('server');
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (password !== confirm) {
      setError(t('mismatch'));
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await redeemPasswordReset(token.trim(), password);
      // Redemption revokes every existing session server-side, so there is
      // nothing to resume — send them to sign in fresh. `replace`, so Back
      // cannot return to a form whose token is now spent.
      router.replace('/login?reset=1');
    } catch (caught) {
      setError(messageFor(caught));
      // Clear the passwords but KEEP the token: if the failure was a weak
      // password, retyping the token they were handed is pure friction.
      setPassword('');
      setConfirm('');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {error ? (
        <div
          role="alert"
          className="bg-destructive/10 text-destructive border-destructive/20 rounded-md border px-3 py-2 text-sm"
        >
          {error}
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="reset-token">{t('token')}</Label>
        <Input
          id="reset-token"
          name="token"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder={t('tokenPlaceholder')}
          // A credential, so it must not reorder under an Arabic layout.
          className="force-ltr"
          autoComplete="one-time-code"
          required
          disabled={isSubmitting}
          aria-invalid={error !== null}
        />
        <p className="text-muted-foreground text-xs">{t('tokenHint')}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="reset-password">{t('password')}</Label>
        <Input
          id="reset-password"
          name="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          required
          disabled={isSubmitting}
          aria-invalid={error !== null}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="reset-confirm">{t('confirm')}</Label>
        <Input
          id="reset-confirm"
          name="confirm"
          type="password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          autoComplete="new-password"
          required
          disabled={isSubmitting}
          aria-invalid={error !== null}
        />
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t('submitting')}
          </>
        ) : (
          t('submit')
        )}
      </Button>
    </form>
  );
}
