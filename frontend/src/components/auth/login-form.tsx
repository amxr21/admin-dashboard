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
  const { signIn } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      await signIn(email, password);
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
