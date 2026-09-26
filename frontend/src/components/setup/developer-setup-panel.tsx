'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAppSettings } from '@/components/providers/settings-provider';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { resetSetup } from '@/lib/setup-api';

/**
 * DEVELOPER-only controls at the top of the setup wizard: see every feature
 * whatever setup chose (this browser only), and put setup back to "never
 * run" so the owner gets the first-login wizard again.
 */
export function DeveloperSetupPanel() {
  const t = useTranslations('setup.developer');
  const settings = useAppSettings();
  const translateError = useTranslatedApiError();
  const [busy, setBusy] = useState(false);

  async function reset() {
    setBusy(true);
    try {
      await resetSetup();
      await settings.refresh();
      toast.success(t('resetDone'));
    } catch (error) {
      toast.error(translateError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="developer-setup-title" className="bg-card space-y-4 rounded-lg border border-dashed p-4">
      <h2 id="developer-setup-title" className="font-semibold">{t('title')}</h2>

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor="developer-view">{t('showEverything')}</Label>
          <p className="text-muted-foreground text-sm">{t('showEverythingHint')}</p>
        </div>
        <Switch id="developer-view" checked={settings.developerView} onCheckedChange={settings.setDeveloperView} />
      </div>

      <div className="flex items-start justify-between gap-4 border-t pt-4">
        <div className="space-y-1">
          <p className="text-sm font-medium">{t('resetTitle')}</p>
          <p className="text-muted-foreground text-sm">{t('resetHint')}</p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={busy}>{t('reset')}</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('resetTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('resetConfirm')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void reset()}>{t('reset')}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </section>
  );
}

/** Persistent while developer view is on, like the "view as" banner. */
export function DeveloperViewBanner() {
  const t = useTranslations('setup.developer');
  const { developerView, setDeveloperView } = useAppSettings();
  if (!developerView) return null;

  return (
    <div
      role="status"
      className="bg-warning/10 text-warning border-warning/20 flex items-center justify-between gap-3 border-b px-4 py-2 text-sm"
    >
      <span>{t('banner')}</span>
      <Button variant="outline" size="sm" onClick={() => setDeveloperView(false)}>
        {t('turnOff')}
      </Button>
    </div>
  );
}
