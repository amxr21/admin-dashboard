'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { CampaignEditor } from '@/components/campaigns/campaign-editor';
import { STATUS_VARIANT } from '@/components/campaigns/campaigns-workspace';
import { ErrorSection } from '@/components/errors/error-section';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/ui/loading-state';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { cancelCampaign, fetchCampaign, type Campaign } from '@/lib/campaigns-api';

/**
 * One campaign: the editor while it is still a draft or scheduled, and its
 * delivery results once sending has begun.
 */
export function CampaignDetail({ id }: { id: string }) {
  const t = useTranslations('campaigns');
  const tStates = useTranslations('states');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setCampaign(await fetchCampaign(id));
      setError(null);
    } catch (caught) {
      setError(translateError(caught));
    }
  }, [id, translateError]);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep the results moving while a campaign is still going out.
  useEffect(() => {
    if (campaign?.status !== 'SENDING') return;
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [campaign?.status, load]);

  if (error) return <ErrorSection title={tStates('error.title')} description={error} onRetry={() => void load()} />;
  if (!campaign) return <LoadingState />;

  const header = (
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="text-xl font-semibold">{campaign.name}</h2>
      <Badge variant={STATUS_VARIANT[campaign.status]}>{t(`status.${campaign.status}`)}</Badge>
      <span className="text-muted-foreground text-sm">{t(`channel.${campaign.channel}`)}</span>
      {campaign.status === 'SCHEDULED' && campaign.scheduledAt ? (
        <span className="text-muted-foreground text-sm">
          {t('detail.scheduledFor', { when: formatter.dateTime(new Date(campaign.scheduledAt), { dateStyle: 'medium', timeStyle: 'short' }) })}
        </span>
      ) : null}
    </div>
  );

  async function cancel() {
    setBusy(true);
    try {
      setCampaign(await cancelCampaign(id));
      toast.success(t('detail.canceled'));
    } catch (caught) {
      setError(translateError(caught));
    } finally {
      setBusy(false);
    }
  }

  const cancelButton =
    campaign.status === 'SCHEDULED' || campaign.status === 'SENDING' ? (
      <Button type="button" variant="outline" disabled={busy} onClick={() => void cancel()}>
        {t(campaign.status === 'SCHEDULED' ? 'detail.cancelSchedule' : 'detail.stop')}
      </Button>
    ) : null;

  if (campaign.status === 'DRAFT' || campaign.status === 'SCHEDULED') {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {header}
          {cancelButton}
        </div>
        <CampaignEditor campaign={campaign} />
      </div>
    );
  }

  const tiles = [
    ['recipients', campaign.audienceSize ?? 0],
    ['pending', campaign.outcomes.pending],
    ['sent', campaign.outcomes.sent],
    ['delivered', campaign.outcomes.delivered],
    ['failed', campaign.outcomes.failed],
    ['bounced', campaign.outcomes.bounced],
  ] as const;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {header}
        {cancelButton}
      </div>
      {campaign.lastError ? (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
          {campaign.lastError}
        </p>
      ) : null}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map(([key, value]) => (
          <div key={key} className="bg-card rounded-lg border p-4">
            <dt className="text-muted-foreground text-sm">{t(`detail.outcomes.${key}`)}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{formatter.number(value)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-muted-foreground text-sm">{t('detail.outcomesHelp')}</p>
      <section className="bg-card space-y-2 rounded-lg border p-4">
        <h3 className="font-semibold">{t('detail.content')}</h3>
        {campaign.subjectEn ? <p className="font-medium">{campaign.subjectEn}</p> : null}
        {campaign.bodyEn ? <p className="text-sm whitespace-pre-wrap">{campaign.bodyEn}</p> : null}
        {campaign.bodyAr ? (
          <div dir="rtl" lang="ar" className="border-t pt-2">
            {campaign.subjectAr ? <p className="font-medium">{campaign.subjectAr}</p> : null}
            <p className="text-sm whitespace-pre-wrap">{campaign.bodyAr}</p>
          </div>
        ) : null}
      </section>
    </div>
  );
}