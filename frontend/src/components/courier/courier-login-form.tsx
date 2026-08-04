'use client';

import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useRouter } from '@/i18n/navigation';
import { ApiError } from '@/lib/api';
import { courierLogin } from '@/lib/courier-api';
import { writeCourierSession } from '@/lib/courier-auth-storage';

/**
 * Courier sign-in — access code only, no email/password. Mirrors
 * `login-form.tsx`'s shape (same error-handling care: a generic message for
 * every rejection reason, since the backend deliberately returns the SAME
 * one for "unknown code" and "suspended courier" — see courier.route.ts) but
 * is its own component, not a shared one, because the two forms authenticate
 * against completely different endpoints and store completely different
 * sessions.
 */
export function CourierLoginForm() {
  const t = useTranslations('courier');
  const tStates = useTranslations('states.error');
  const router = useRouter();

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const result = await courierLogin(code);
      writeCourierSession(result.token, result.courier);
      router.replace('/courier');
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.status === 429 ? t('login.rateLimited') : t('login.invalidCode'));
      } else {
        setError(tStates('network'));
      }
      setCode('');
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
        <Label htmlFor="courier-code">{t('login.codeLabel')}</Label>
        <Input
          id="courier-code"
          name="code"
          type="text"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder={t('login.codePlaceholder')}
          autoComplete="off"
          // A code is issued in groups (see the admin-side access-code panel)
          // but accepted with or without the dashes — same as the backend.
          className="force-ltr text-center font-mono tracking-widest"
          required
          disabled={isSubmitting}
          aria-invalid={error !== null}
        />
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t('login.signingIn')}
          </>
        ) : (
          t('login.signIn')
        )}
      </Button>
    </form>
  );
}
