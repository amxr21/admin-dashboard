'use client';

import { useTranslations } from 'next-intl';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { landingFor } from '@/config/areas';
import { Link, useRouter } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { normalizeAccountEmail } from '@/lib/identity-validation';
import { hasPendingSessionRecovery, takeSessionReturnPath } from '@/lib/session-recovery';

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

function SessionExpiredNotice() {
  const t = useTranslations('auth');
  const [visible, setVisible] = useState(false);

  useEffect(() => setVisible(hasPendingSessionRecovery()), []);
  if (!visible) return null;

  return (
    <div role="status" className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{t('sessionExpired')}</span>
    </div>
  );
}

export function LoginForm() {
  const t = useTranslations('auth');
  const tStates = useTranslations('states.error');
  const { signIn, verifyTwoFactor } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  /**
   * The second half of a 2FA login (O3b.1).
   *
   * ─── WHY THE PENDING TOKEN LIVES IN STATE AND NOWHERE ELSE ─────────
   * It proves the password step already happened, which makes it a
   * credential — a short-lived one, but one that skips the password if
   * stolen. In `localStorage` it would outlive the tab and sit there for any
   * script on the origin to read; in the URL it would reach history, the
   * server's logs and any referrer. React state dies with the page, which is
   * exactly the lifetime this needs.
   *
   * `null` means "no 2FA step in progress" and is what puts the password form
   * back on screen, so there is one source of truth for which half we are in.
   */
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
      const result = await signIn(normalizeAccountEmail(email), password);

      // The password checked out but no session exists yet — `signIn` wrote
      // nothing. Hand over to the code step rather than redirecting, which
      // before O3b.1 sent them to /admin with no token at all.
      if (result.status === 'TWO_FACTOR_REQUIRED') {
        setPendingToken(result.pendingToken);
        // The password is spent either way; not keeping it around.
        setPassword('');
        return;
      }

      // Where they land depends on the job (O3.4). A FULFILLMENT user has no
      // `reports` grant, so the revenue dashboard is a screen built to answer
      // a question they are not allowed to ask.
      // replace, not push — Back must not return to a login form the user has
      // already passed.
      router.replace(takeSessionReturnPath() ?? landingFor(result.role));
    } catch (caught) {
      setError(messageFor(caught));
      // Deliberately NOT clearing the email. Retyping it after a typo in the
      // password is pure friction.
      setPassword('');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pendingToken === null) return;

    setError(null);
    setIsSubmitting(true);

    try {
      const role = await verifyTwoFactor(pendingToken, code);
      router.replace(takeSessionReturnPath() ?? landingFor(role));
    } catch (caught) {
      setError(messageFor(caught));
      // The code is single-use and time-boxed, so a wrong one is always
      // retyped rather than corrected — clearing it saves a select-all.
      setCode('');
    } finally {
      setIsSubmitting(false);
    }
  }

  /**
   * The code step. A separate form, not a third field on the first one: the
   * password is already spent, and re-rendering it would invite the browser
   * to re-submit credentials that no longer prove anything.
   */
  if (pendingToken !== null) {
    return (
      <form onSubmit={handleVerify} className="space-y-4" noValidate>
        <div className="space-y-1">
          <h2 className="font-medium">{t('twoFactor.title')}</h2>
          <p className="text-muted-foreground text-sm">{t('twoFactor.hint')}</p>
        </div>

        {error ? (
          <div
            role="alert"
            className="bg-destructive/10 text-destructive border-destructive/20 rounded-md border px-3 py-2 text-sm"
          >
            {error}
          </div>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="totp-code">{t('twoFactor.code')}</Label>
          <Input
            id="totp-code"
            name="code"
            // A backup code is alphanumeric, so this cannot be type=number —
            // and inputMode/autoComplete still give phones the numeric pad
            // and the OS its one-time-code autofill for the TOTP case.
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            // force-ltr: a code is a code, and must not reorder in Arabic.
            className="force-ltr"
            maxLength={16}
            required
            autoFocus
            disabled={isSubmitting}
            aria-invalid={error !== null}
          />
          <p className="text-muted-foreground text-xs">{t('twoFactor.backupHint')}</p>
        </div>

        <Button type="submit" className="w-full" disabled={isSubmitting || code.trim() === ''}>
          {isSubmitting ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t('signingIn')}
            </>
          ) : (
            t('twoFactor.verify')
          )}
        </Button>

        {/* A way back that does not require closing the tab: the pending
            token is dropped, so this genuinely restarts the sign-in rather
            than hiding a half-finished one. */}
        <p className="text-muted-foreground text-center text-sm">
          <button
            type="button"
            onClick={() => {
              setPendingToken(null);
              setCode('');
              setError(null);
            }}
            className="hover:text-foreground underline underline-offset-4"
          >
            {t('twoFactor.startOver')}
          </button>
        </p>
      </form>
    );
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
      <SessionExpiredNotice />

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

      {/* The ONLY discoverable route to account recovery. Without this,
          someone locked out has to be sent the URL by hand — and the
          admin-issued token they were given would have nowhere to go. One
          link, because /reset-password now holds both steps: ask for a code
          there, or redeem one you were already given. */}
      <p className="text-muted-foreground text-center text-sm">
        <Link
          href="/reset-password"
          className="hover:text-foreground underline underline-offset-4"
        >
          {t('forgotPassword')}
        </Link>
      </p>
    </form>
  );
}
