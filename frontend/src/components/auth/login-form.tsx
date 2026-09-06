'use client';

import { useTranslations } from 'next-intl';
import { Suspense, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { Link, useRouter } from '@/i18n/navigation';
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
/**
 * The one thing on this page that reads the URL (`?reset=1`, set by the reset
 * form after a successful redemption).
 *
 * Split into its own component so the `useSearchParams()` bailout is confined
 * to it. Without the notice, someone who just set a password lands on a bare
 * sign-in form with no acknowledgement — which reads as "it didn't work" in
 * the one flow where the user is already anxious about being locked out.
 * Redemption revokes every session server-side, so arriving here IS the
 * success path.
 */
function ResetSuccessNotice({ suppressed }: { suppressed: boolean }) {
  const t = useTranslations('auth');
  const justReset = useSearchParams().get('reset') === '1';

  if (!justReset || suppressed) return null;

  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400"
    >
      {/* Icon AND colour — never colour alone, per the app-wide rule. */}
      <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{t('reset.done')}</span>
    </div>
  );
}

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
      {/* Suppressed once an error exists: the failure is the newer and more
          actionable fact, and stacking "password set" above "that password
          isn't right" is actively confusing.

          Inside <Suspense> because it reads `useSearchParams()`, which opts
          the whole subtree out of static prerendering unless a boundary
          contains it — without one, `next build` fails outright on
          /[locale]/login. Wrapping only the BANNER rather than the page keeps
          the form itself statically rendered: the fallback is null because a
          missing success note for one frame is invisible, where a suspended
          sign-in form would be a blank page. */}
      <Suspense fallback={null}>
        <ResetSuccessNotice suppressed={error !== null} />
      </Suspense>

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

      {/* The ONLY discoverable route to the reset page. Without this, someone
          locked out has to be sent the URL by hand — and the admin-issued
          token they were given would have nowhere to go. */}
      <p className="text-muted-foreground text-center text-sm">
        <Link
          href="/reset-password"
          className="hover:text-foreground underline underline-offset-4"
        >
          {t('haveResetCode')}
        </Link>
      </p>
    </form>
  );
}
