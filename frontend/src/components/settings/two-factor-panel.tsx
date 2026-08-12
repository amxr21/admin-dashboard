'use client';

/* eslint-disable @next/next/no-img-element -- the QR code is a data: URL from
   our own API, not a remote image; next/image's optimizer adds nothing here
   and cannot even accept a data URL without extra config. */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy, KeyRound, ShieldCheck, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { useAppSettings } from '@/components/providers/settings-provider';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import {
  beginTwoFactorSetup,
  confirmTwoFactorSetup,
  disableTwoFactor,
  fetchTwoFactorStatus,
  type TwoFactorSetup,
  type TwoFactorStatus,
} from '@/lib/two-factor-api';

/**
 * Two-factor authentication (B2.8) — self-service enable/disable.
 *
 * ─── WHY SETUP AND CONFIRM ARE TWO SEPARATE STEPS ─────────────────────
 * `beginTwoFactorSetup` generates a secret and stores it, but does NOT turn
 * 2FA on. Only `confirmTwoFactorSetup`, which requires a REAL code from the
 * authenticator app, does that — proving the QR code was actually scanned by
 * a working app before login starts depending on it. See
 * `two-factor.service.ts`'s own doc comment for the same reasoning stated
 * from the backend side.
 */
export function TwoFactorPanel() {
  const t = useTranslations('settings.twoFactor');
  const translateError = useTranslatedApiError();
  const { editPanelMode } = useAppSettings();

  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [settingUp, setSettingUp] = useState(false);
  const [disabling, setDisabling] = useState(false);

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      setStatus(await fetchTwoFactorStatus());
    } catch (caught) {
      setError(translateError(caught));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section aria-labelledby="settings-group-2fa" className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <ShieldCheck className="text-primary size-5" aria-hidden="true" />
          <h2 id="settings-group-2fa" className="text-lg font-semibold tracking-tight">
            {t('title')}
          </h2>
        </div>
        <p className="text-muted-foreground text-sm">{t('description')}</p>
      </div>

      <div className="bg-card/50 space-y-4 rounded-lg border p-4">
        {error ? (
          <p className="text-destructive text-sm">{error}</p>
        ) : isLoading || !status ? (
          <Skeleton className="h-12 w-full" />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {status.enabled ? (
                <Badge variant="secondary">{t('enabled')}</Badge>
              ) : (
                <Badge variant="outline">{t('disabled')}</Badge>
              )}
              {status.enabled ? (
                <span className="text-muted-foreground text-sm">
                  {t('backupCodesRemaining', { count: status.remainingBackupCodes })}
                </span>
              ) : null}
            </div>

            {status.enabled ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setDisabling(true)}>
                {t('disable')}
              </Button>
            ) : (
              <Button type="button" size="sm" onClick={() => setSettingUp(true)}>
                <KeyRound aria-hidden />
                {t('enable')}
              </Button>
            )}
          </div>
        )}
      </div>

      {settingUp ? (
        <SetupSheet
          editPanelMode={editPanelMode}
          onDone={() => {
            setSettingUp(false);
            void load();
          }}
        />
      ) : null}

      {disabling ? (
        <DisableDialog
          onDone={() => {
            setDisabling(false);
            void load();
          }}
        />
      ) : null}
    </section>
  );
}

type SetupStep = 'scan' | 'reveal-codes';

function SetupSheet({
  editPanelMode,
  onDone,
}: {
  editPanelMode: 'drawer' | 'modal';
  onDone: () => void;
}) {
  const t = useTranslations('settings.twoFactor');
  const translateError = useTranslatedApiError();

  const [step, setStep] = useState<SetupStep>('scan');
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    beginTwoFactorSetup()
      .then(setSetup)
      .catch((caught: unknown) => setError(translateError(caught)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function confirm() {
    setIsSubmitting(true);
    setError(null);

    try {
      const result = await confirmTwoFactorSetup(code);
      setBackupCodes(result.backupCodes);
      setStep('reveal-codes');
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 400
          ? caught.message
          : translateError(caught),
      );
      setCode('');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function copyBackupCodes() {
    try {
      await navigator.clipboard.writeText(backupCodes.join('\n'));
      setCopied(true);
    } catch {
      // Clipboard access can be refused. The codes are on screen and
      // selectable — a convenience failing, not the feature failing.
      setCopied(false);
    }
  }

  if (step === 'reveal-codes') {
    return (
      <AlertDialog open onOpenChange={() => {}}>
        <AlertDialogContent
          className="max-w-md space-y-4"
          onEscapeKeyDown={(event) => event.preventDefault()}
        >
          <div className="flex items-start gap-3">
            <KeyRound className="text-warning mt-0.5 size-5 shrink-0" aria-hidden />
            <div className="min-w-0">
              <AlertDialogTitle className="font-medium">{t('backupCodesTitle')}</AlertDialogTitle>
              <AlertDialogDescription className="mt-1 flex items-start gap-1.5">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {t('backupCodesShownOnce')}
              </AlertDialogDescription>
            </div>
          </div>

          <ul className="bg-card force-ltr grid select-all grid-cols-2 gap-2 rounded-md border p-3 text-center text-sm tabular-nums">
            {backupCodes.map((backupCode) => (
              <li key={backupCode} className="tracking-wide">
                {backupCode}
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between gap-3">
            <Button type="button" variant="outline" size="sm" onClick={() => void copyBackupCodes()}>
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied ? t('copied') : t('copyBackupCodes')}
            </Button>
            <Button size="sm" onClick={onDone}>
              {t('done')}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <Sheet open onOpenChange={(next) => !next && onDone()}>
      <SheetContent side="end" variant={editPanelMode} title={t('setupTitle')} className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">{t('setupTitle')}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{t('setupDescription')}</p>
        </div>

        {error && !setup ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : !setup ? (
          <Skeleton className="mx-auto size-48" />
        ) : (
          <>
            <img
              src={setup.qrCodeDataUrl}
              alt={t('qrCodeAlt')}
              className="mx-auto size-48 rounded-md border"
            />
            <div className="space-y-1">
              <p className="text-muted-foreground text-center text-xs">{t('cantScan')}</p>
              <code className="bg-card force-ltr block select-all rounded-md border px-3 py-2 text-center text-sm tracking-wide">
                {setup.secret}
              </code>
            </div>

            <div className="space-y-2">
              <Label htmlFor="two-factor-setup-code">{t('enterCode')}</Label>
              <Input
                id="two-factor-setup-code"
                className="force-ltr"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoFocus
                disabled={isSubmitting}
              />
            </div>

            {error ? (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            ) : null}

            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={isSubmitting || !code.trim()}
                onClick={() => void confirm()}
              >
                {isSubmitting ? t('verifying') : t('verifyAndEnable')}
              </Button>
              <Button variant="outline" size="sm" onClick={onDone}>
                {t('cancel')}
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DisableDialog({ onDone }: { onDone: () => void }) {
  const t = useTranslations('settings.twoFactor');
  const translateError = useTranslatedApiError();

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function confirm() {
    setIsSubmitting(true);
    setError(null);

    try {
      await disableTwoFactor(code);
      toast.success(t('disabled'));
      onDone();
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 400
          ? caught.message
          : translateError(caught),
      );
      setCode('');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AlertDialog open onOpenChange={(next) => !next && onDone()}>
      <AlertDialogContent className="max-w-md space-y-4">
        <div>
          <AlertDialogTitle>{t('disableTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('disableDescription')}</AlertDialogDescription>
        </div>

        <div className="space-y-2">
          <Label htmlFor="two-factor-disable-code">{t('enterCode')}</Label>
          <Input
            id="two-factor-disable-code"
            className="force-ltr"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoFocus
            disabled={isSubmitting}
          />
        </div>

        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onDone} disabled={isSubmitting}>
            {t('cancel')}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={isSubmitting || !code.trim()}
            onClick={() => void confirm()}
          >
            {isSubmitting ? t('disabling') : t('confirmDisable')}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
