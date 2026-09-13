'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Link } from '@/i18n/navigation';
import { useAppSettings } from '@/components/providers/settings-provider';
import { Button } from '@/components/ui/button';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { skipSetup } from '@/lib/setup-api';
import type { StaffRole } from '@/config/areas';

export function SetupPrompt({ role }: { role: StaffRole }) {
  const t = useTranslations('setup');
  const settings = useAppSettings();
  const translateError = useTranslatedApiError();
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  if ((role !== 'OWNER' && role !== 'DEVELOPER') || settings.isLoading || settings.setupCompletedAt || settings.setupSkippedAt || dismissed) return null;
  async function skip() {
    setBusy(true);
    try { await skipSetup(); setDismissed(true); toast.success(t('skipped')); await settings.refresh(); }
    catch (error) { toast.error(translateError(error)); }
    finally { setBusy(false); }
  }
  return <section aria-label={t('title')} className="bg-card mb-5 space-y-3 rounded-lg border p-4"><h2 className="font-semibold">{t('title')}</h2><p className="text-muted-foreground text-sm">{t('intro')}</p><div className="flex flex-wrap gap-2"><Button asChild disabled={busy}><Link href="/admin/setup">{t('start')}</Link></Button><Button variant="outline" disabled={busy} onClick={() => void skip()}>{t('skip')}</Button></div></section>;
}
