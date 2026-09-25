'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Mail, MessageSquare, Plus } from 'lucide-react';

import { ErrorSection } from '@/components/errors/error-section';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/ui/loading-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useTranslatedApiError } from '@/hooks/useTranslatedApiError';
import { Link } from '@/i18n/navigation';
import {
  fetchCampaignReadiness,
  fetchCampaigns,
  type Campaign,
  type CampaignReadiness,
  type CampaignStatus,
} from '@/lib/campaigns-api';

export const STATUS_VARIANT: Record<CampaignStatus, 'muted' | 'info' | 'warning' | 'success' | 'destructive' | 'outline'> = {
  DRAFT: 'muted',
  SCHEDULED: 'info',
  SENDING: 'warning',
  COMPLETED: 'success',
  CANCELED: 'outline',
  FAILED: 'destructive',
};

/** Campaign list, with a plain statement of which channels can send. */
export function CampaignsWorkspace() {
  const t = useTranslations('campaigns');
  const tStates = useTranslations('states');
  const formatter = useFormatter();
  const translateError = useTranslatedApiError();
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [readiness, setReadiness] = useState<CampaignReadiness | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [rows, ready] = await Promise.all([fetchCampaigns(), fetchCampaignReadiness()]);
      setCampaigns(rows);
      setReadiness(ready);
    } catch (caught) {
      setError(translateError(caught));
    }
  }, [translateError]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorSection title={tStates('error.title')} description={error} onRetry={() => void load()} />;
  if (!campaigns || !readiness) return <LoadingState />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <ul className="flex flex-wrap gap-2 text-sm" aria-label={t('readiness.label')}>
          {(['EMAIL', 'SMS'] as const).map((channel) => (
            <li key={channel} className="bg-card flex items-center gap-2 rounded-md border px-3 py-1.5">
              {channel === 'EMAIL' ? <Mail className="size-4" aria-hidden /> : <MessageSquare className="size-4" aria-hidden />}
              <span>{t(`channel.${channel}`)}</span>
              <Badge variant={readiness[channel].ready ? 'success' : 'muted'}>
                {readiness[channel].ready ? t('readiness.ready') : t('readiness.notReady')}
              </Badge>
            </li>
          ))}
        </ul>
        <Button asChild>
          <Link href="/admin/campaigns/new">
            <Plus aria-hidden />
            {t('new')}
          </Link>
        </Button>
      </div>

      {!readiness.EMAIL.ready || !readiness.SMS.ready ? (
        <p className="text-muted-foreground text-sm">{t('readiness.help')}</p>
      ) : null}

      {campaigns.length === 0 ? (
        <div className="bg-card rounded-lg border border-dashed px-6 py-10 text-center">
          <p className="font-medium">{t('empty.title')}</p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">{t('empty.body')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.name')}</TableHead>
                <TableHead>{t('columns.channel')}</TableHead>
                <TableHead>{t('columns.status')}</TableHead>
                <TableHead className="text-end">{t('columns.recipients')}</TableHead>
                <TableHead className="text-end">{t('columns.sent')}</TableHead>
                <TableHead>{t('columns.when')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((campaign) => {
                const when = campaign.startedAt ?? campaign.scheduledAt ?? campaign.updatedAt;
                return (
                  <TableRow key={campaign.id}>
                    <TableCell>
                      <Link href={`/admin/campaigns/${campaign.id}`} className="font-medium hover:underline">
                        {campaign.name}
                      </Link>
                    </TableCell>
                    <TableCell>{t(`channel.${campaign.channel}`)}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[campaign.status]}>{t(`status.${campaign.status}`)}</Badge>
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {campaign.audienceSize === null ? '—' : formatter.number(campaign.audienceSize)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {formatter.number(campaign.outcomes.sent + campaign.outcomes.delivered)}
                    </TableCell>
                    <TableCell>
                      <time dateTime={when}>{formatter.dateTime(new Date(when), { dateStyle: 'medium', timeStyle: 'short' })}</time>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
