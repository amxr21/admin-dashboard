'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';

/**
 * Sign-in form.
 *
 * ─── ERROR MESSAGES ARE PER-STATUS, NOT GENERIC ──────────────────────
 * Each failure implies a different user action, and collapsing them into
 * "Something went wrong" makes a recoverable problem read as a broken app:
 *
 *   401 → the credentials are wrong; try again
 *   403 → the account is disabled or expired; contact an owner, retrying
 *         forever will not help
 *   423 → locked out; WAIT, and know for how long
 *   429 → rate limited by IP; wait briefly
 *   5xx / network → not the user's fault at all
 *
 * The backend deliberately returns the SAME message for unknown-email and
 * wrong-password (user enumeration), so this does not try to distinguish them.
 */
export function LoginForm() {
  const t = useTranslations('auth');
  const tStates = useTranslations('states.error');
  const { signIn, verifyTwoFactor } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Non-null once the password step succeeds on a 2FA account. Its presence
  // is what switches the form into the second-step view below — there is no
  // separate boolean to keep in sync with it.
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [code, setCode] = useState('');

  function messageFor(caught: unknown): string {
    if (!(caught instanceof ApiError)) {
      // fetch rejects rather than resolving when the network is unreachable.
      return tStates('network');
    }

    switch (caught.status) {
      case 401:
        return t('invalidCredentials');
      case 403:
        return caught.message.toLowerCase().includes('deactivated')
          ? t('accountDeactivated')
          : t('accessEnded');
      case 423:
        // The API states the duration in its message; the translated string
        // needs the number, so parse it rather than hardcoding 15.
        return t('accountLocked', {
          minutes: /(\d+)/.exec(caught.message)?.[1] ?? '15',
        });
      case 429:
        return t('rateLimited');
      default:
        return tStates('server');
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const result = await signIn(email, password);

      if (result.status === 'TWO_FACTOR_REQUIRED') {
        // NOT a completed sign-in — no navigation, no session exists yet.
        // Switch to the second-step view and stop here.
        setPendingToken(result.pendingToken);
        return;
      }

      // replace, not push — Back must not return to a login form the user has
      // already passed.
      router.replace('/admin');
    } catch (caught) {
      setError(messageFor(caught));
      // Deliberately NOT clearing the email. Retyping it after a typo in the
      // password is pure friction.
      setPassword('');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleVerifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pendingToken) return; // unreachable — the form only renders with one

    setError(null);
    setIsSubmitting(true);

    try {
      await verifyTwoFactor(pendingToken, code);
      router.replace('/admin');
    } catch (caught) {
      // A wrong code is a 400, not one of the login-step statuses (401/423/
      // 429) — messageFor's default branch reads as "server error", which is
      // wrong here. This step has exactly one failure mode worth naming.
      setError(
        caught instanceof ApiError && caught.status === 400
          ? t('invalidCode')
          : messageFor(caught),
      );
      setCode('');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (pendingToken) {
    return (
      <form onSubmit={(event) => void handleVerifyCode(event)} className="space-y-4" noValidate>
        {error ? (
          <div
            role="alert"
            className="bg-destructive/10 text-destructive border-destructive/20 rounded-md border px-3 py-2 text-sm"
          >
            {error}
          </div>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="two-factor-code">{t('twoFactorCode')}</Label>
          <p className="text-muted-foreground text-sm">{t('twoFactorCodeHint')}</p>
          <Input
            id="two-factor-code"
            name="code"
            // Not type=number — a backup code is alphanumeric with a dash,
            // and a spinner control on a 6-digit TOTP code is pure noise.
            inputMode="text"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoFocus
            required
            disabled={isSubmitting}
            aria-invalid={error !== null}
            className="force-ltr"
          />
        </div>

        <Button type="submit" className="w-full" disabled={isSubmitting || !code.trim()}>
          {isSubmitting ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t('signingIn')}
            </>
          ) : (
            t('verifyCode')
          )}
        </Button>

        <Button
          type="button"
          variant="ghost"
          className="w-full"
          disabled={isSubmitting}
          onClick={() => {
            setPendingToken(null);
            setCode('');
            setError(null);
          }}
        >
          {t('backToLogin')}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {error ? (
        // role=alert so it is announced immediately — a sighted user sees the
        // message appear, a screen-reader user would otherwise get nothing.
        <div
          role="alert"
          className="bg-destructive/10 text-destructive border-destructive/20 rounded-md border px-3 py-2 text-sm"
        >
          {error}
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="email">{t('email')}</Label>
        <Input
          id="email"
          name="email"
          // type=email gets the right mobile keyboard AND is what globals.css
          // targets to force LTR — an address must not reorder in Arabic.
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={t('emailPlaceholder')}
          autoComplete="email"
          required
          disabled={isSubmitting}
          aria-invalid={error !== null}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">{t('password')}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
          disabled={isSubmitting}
          aria-invalid={error !== null}
        />
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? (
          <>
            {/* CSS spin, not GSAP — a continuous loop needs no orchestration
                and stays off the JS thread. No direction, so no mirroring. */}
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t('signingIn')}
          </>
        ) : (
          t('signIn')
        )}
      </Button>
    </form>
  );
}
