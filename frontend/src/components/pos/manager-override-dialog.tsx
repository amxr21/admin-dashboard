'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { requestManagerOverride, type ManagerOverrideResult } from '@/lib/auth-api';

/**
 * Manager override at the till (O9 Tier 4).
 *
 * A generic, reusable dialog rather than something built INTO the discount
 * feature it was first asked for — the owner's own note named a second
 * future use (voids, once built), and a dialog wired one level up in a
 * specific feature is exactly the kind of thing that gets copy-pasted for
 * the next caller instead of reused.
 *
 * ─── WHY THIS NEVER TOUCHES THE CASHIER'S OWN SESSION ─────────────────
 * The manager types their OWN email + password here, on the CASHIER's
 * screen. Nothing here signs the manager in, switches the active session,
 * or reads/writes anything about who is currently authenticated — the
 * backend endpoint this calls is deliberately built the same way (see its
 * own doc comment). A caller wanting to know "was this approved" reads the
 * `onApproved` callback's result, not `useAuth()`.
 */
interface ManagerOverrideDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What the manager is being asked to authorise — shown in the dialog body
   *  so they know what they are approving before typing a password. */
  reason: string;
  onApproved: (result: ManagerOverrideResult) => void;
}

export function ManagerOverrideDialog({
  open,
  onOpenChange,
  reason,
  onApproved,
}: ManagerOverrideDialogProps) {
  const t = useTranslations('pos.managerOverride');
  const translateError = useTranslatedApiError();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setEmail('');
    setPassword('');
    setError(null);
  }

  async function submit() {
    setIsBusy(true);
    setError(null);

    try {
      const result = await requestManagerOverride(email.trim(), password);
      reset();
      onOpenChange(false);
      onApproved(result);
    } catch (caught) {
      // A wrong password or a non-manager account is something the person
      // typing has to read and act on — shown verbatim rather than
      // flattened, same discipline as every other till refusal.
      setError(
        caught instanceof ApiError && (caught.status === 401 || caught.status === 403)
          ? caught.message
          : translateError(caught),
      );
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // Only the CANCEL path clears the fields — a password left on
        // screen after a failed submit while the dialog stays open would be
        // discarded work; clearing it on every close would also wipe it the
        // instant a slow network response comes back after the person
        // already dismissed the dialog by mistake.
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('title')}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4">
              <p>{reason}</p>

              <div className="space-y-2 text-start">
                <Label htmlFor="override-email">{t('emailLabel')}</Label>
                <Input
                  id="override-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="off"
                  className="force-ltr"
                  disabled={isBusy}
                />
              </div>

              <div className="space-y-2 text-start">
                <Label htmlFor="override-password">{t('passwordLabel')}</Label>
                <Input
                  id="override-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="off"
                  className="force-ltr"
                  disabled={isBusy}
                />
              </div>

              {error ? (
                <p
                  role="alert"
                  className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
                >
                  {error}
                </p>
              ) : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isBusy}>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            // Radix's Action closes on click by default — prevented so a
            // FAILED approval keeps the dialog open with the refusal
            // visible, same reasoning as the till's own checkout confirm.
            onClick={(event) => {
              event.preventDefault();
              void submit();
            }}
            disabled={isBusy || email.trim() === '' || password === ''}
          >
            {isBusy ? t('approving') : t('approve')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
