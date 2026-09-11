'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Loader2, MailCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { requestPasswordReset } from '@/lib/auth-api';
import { isAccountEmailValid, normalizeAccountEmail } from '@/lib/identity-validation';

/**
 * Ask for a reset code by email, for someone with no admin to ask.
 *
 * ─── SUCCESS SAYS THE SAME THING FOR EVERY ADDRESS ───────────────────
 * The backend answers 200 whether or not the address belongs to an account,
 * so this form renders ONE confirmation and never reports "sent" versus "no
 * such user". Distinguishing them here would rebuild the staff-directory
 * oracle the server deliberately refuses to expose — an attacker could
 * enumerate who works here and aim credential stuffing at addresses already
 * known to be real. The copy is written to be honest about that: it says a
 * code has been sent IF the address has an account, rather than implying one
 * is on its way.
 *
 * The form is not cleared and reset afterwards either — the panel is replaced
 * outright, so there is no submit button left to hammer for a different
 * answer.
 *
 * ─── WHY THE EMAIL CHECK HERE IS ONLY A HINT ─────────────────────────
 * `isAccountEmailValid` shares its normalization with the server's Zod
 * contract, but the server stays authoritative. This check exists to catch a
 * typo before spending one of five rate-limited attempts, not to decide the
 * request.
 */
export function ForgotPasswordForm() {
  const t = useTranslations('auth.forgot');
  const tStates = useTranslations('states.error');

  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSent, setIsSent] = useState(false);

  function messageFor(caught: unknown): string {
    if (!(caught instanceof ApiError)) return tStates('network');

    // 429 is the one failure worth naming: it is the only one the person can
    // act on, by waiting. Everything else is a server problem they cannot fix
    // and should not be asked to interpret.
    return caught.status === 429 ? t('rateLimited') : tStates('server');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalized = normalizeAccountEmail(email);

    if (!isAccountEmailValid(normalized)) {
      setError(t('invalidEmail'));
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      await requestPasswordReset(normalized);
      setIsSent(true);
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isSent) {
    return (
      // `role="status"` rather than `alert`: this replaces the form after a
      // deliberate submit, so it is a polite confirmation, not an interruption.
      <div role="status" className="space-y-3 text-center">
        <span className="bg-primary/10 text-primary mx-auto flex size-12 items-center justify-center rounded-xl">
          <MailCheck className="size-6" aria-hidden />
        </span>
        <p className="text-sm font-medium">{t('sentTitle')}</p>
        <p className="text-muted-foreground text-sm">{t('sentBody')}</p>
      </div>
    );
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
        <Label htmlFor="forgot-email">{t('email')}</Label>
        <Input
          id="forgot-email"
          name="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          // An address must not reorder under an Arabic layout.
          className="force-ltr"
          autoComplete="username"
          required
          disabled={isSubmitting}
          aria-invalid={error !== null}
        />
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t('sending')}
          </>
        ) : (
          t('submit')
        )}
      </Button>
    </form>
  );
}
