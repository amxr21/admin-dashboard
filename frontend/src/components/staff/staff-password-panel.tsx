'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { KeyRound } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { ApiError } from '@/lib/api';
import { useAppSettings } from '@/components/providers/settings-provider';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { setStaffPassword, type StaffMember } from '@/lib/staff-api';

/**
 * Set someone else's password.
 *
 * ─── THE PASSWORD IS NEVER ECHOED BACK ───────────────────────────────
 * Unlike a courier access code, this one is CHOSEN by the person typing it, so
 * there is nothing to reveal — they already know it. The API returns the staff
 * record and no credential, and this panel keeps the value only until it is
 * submitted.
 *
 * The note about telling them directly is not decoration: nothing emails them.
 * Without it someone sets a password and assumes the person was notified.
 */

interface StaffPasswordPanelProps {
  member: StaffMember;
  /** Message to surface, or null when cancelled. */
  onDone: (message: string | null) => void;
}

/** Mirrors the server's floor. It rejects anything shorter regardless. */
const MIN_LENGTH = 12;

export function StaffPasswordPanel({ member, onDone }: StaffPasswordPanelProps) {
  const t = useTranslations('staff');
  const translateError = useTranslatedApiError();
  const { editPanelMode } = useAppSettings();

  const [password, setPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const name = member.name ?? member.email;
  const tooShort = password.length > 0 && password.length < MIN_LENGTH;

  async function submit() {
    if (password.length < MIN_LENGTH) return;

    setIsSaving(true);
    setError(null);

    try {
      await setStaffPassword(member.id, password);
      // Cleared immediately — there is no reason for it to outlive the request.
      setPassword('');
      onDone(t('notice.passwordSet', { name }));
    } catch (caught) {
      setError(
        caught instanceof ApiError && (caught.status === 400 || caught.status === 403)
          ? caught.message
          : translateError(caught),
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Sheet open onOpenChange={(next) => { if (!next) onDone(null); }}>
      <SheetContent
        variant={editPanelMode}
        title={t('password.title', { name })}
        className="space-y-4"
      >
        <div className="flex items-start gap-3">
          <KeyRound className="text-warning mt-0.5 size-5 shrink-0" aria-hidden />
          <div className="min-w-0">
            <p className="font-medium">{t('password.title', { name })}</p>
            <p className="text-muted-foreground mt-1 text-sm">{t('password.description')}</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="staff-new-password">{t('password.label')}</Label>
          <Input
            id="staff-new-password"
            // A real password type: the browser must not autofill it from the
            // ADMIN's saved credentials, and it must not be shoulder-readable.
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={tooShort ? true : undefined}
            aria-describedby="staff-password-hint"
          />
          <p
            id="staff-password-hint"
            className={tooShort ? 'text-destructive text-sm' : 'text-muted-foreground text-sm'}
          >
            {t('form.passwordHint')}
          </p>
        </div>

        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={password.length < MIN_LENGTH || isSaving}
            onClick={() => void submit()}
          >
            {t('password.confirm')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => onDone(null)}>
            {t('password.cancel')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
