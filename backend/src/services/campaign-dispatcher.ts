import { CampaignRecipientStatus, CampaignStatus } from '@prisma/client';

import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';
import { normaliseAddress } from './campaign-audience.service.js';
import { channelReadiness, SendFailure, sendEmail, sendSms, unsubscribeUrl } from './campaign-channels.js';
import { pickLocale, renderEmail, renderSms } from './campaign-render.js';
import { contentOf, renderValues, startCampaign } from './campaigns.service.js';
import { getSettingValue } from './settings.service.js';

/**
 * Delivers queued campaign messages, a rate-limited batch per minute.
 *
 * ─── NO MESSAGE IS SENT TWICE ───────────────────────────────────────
 * A recipient is CLAIMED (PENDING → SENDING) by a conditional update before
 * anything is sent, so two server instances ticking at once cannot both take
 * it. A row found still SENDING long after its claim means the process died
 * mid-send — whether the provider accepted it is unknowable, so it is marked
 * FAILED rather than retried: a missed promotion is recoverable, a duplicate
 * one is the complaint this exists to prevent.
 */

const MAX_ATTEMPTS = 3;
/** A claim older than this is an interrupted send (see above). */
const STUCK_AFTER_MS = 10 * 60 * 1000;

function backoff(attempts: number): Date {
  return new Date(Date.now() + 2 ** attempts * 60_000);
}

async function startDueCampaigns() {
  const due = await prisma.campaign.findMany({
    where: { status: CampaignStatus.SCHEDULED, scheduledAt: { lte: new Date() } },
    select: { id: true },
  });

  for (const { id } of due) {
    try {
      await startCampaign(id);
      logger.info({ event: 'campaign.started', campaignId: id });
    } catch (error) {
      await prisma.campaign.updateMany({
        where: { id, status: CampaignStatus.SCHEDULED },
        data: { status: CampaignStatus.FAILED, lastError: error instanceof Error ? error.message.slice(0, 500) : 'Could not start' },
      });
      logger.error({ event: 'campaign.start.failed', campaignId: id, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

async function failInterruptedSends() {
  await prisma.campaignRecipient.updateMany({
    where: { status: CampaignRecipientStatus.SENDING, updatedAt: { lt: new Date(Date.now() - STUCK_AFTER_MS) } },
    data: { status: CampaignRecipientStatus.FAILED, lastError: 'Interrupted while sending; not retried to avoid a duplicate' },
  });
}

async function suppressAddress(channel: 'EMAIL' | 'SMS', address: string, reason: 'UNSUBSCRIBED' | 'BOUNCED' | 'COMPLAINED' | 'MANUAL') {
  await prisma.marketingSuppression.upsert({
    where: { channel_address: { channel, address: normaliseAddress(channel, address) } },
    create: { channel, address: normaliseAddress(channel, address), reason },
    update: {},
  });
}

async function deliverBatch() {
  const readiness = await channelReadiness();
  const budget = Math.max(1, Number(await getSettingValue('campaigns.sendsPerMinute')));

  const candidates = await prisma.campaignRecipient.findMany({
    where: {
      status: CampaignRecipientStatus.PENDING,
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      campaign: { status: CampaignStatus.SENDING },
    },
    orderBy: { createdAt: 'asc' },
    take: budget,
    select: { id: true },
  });

  const valuesCache = new Map<string, Awaited<ReturnType<typeof renderValues>>>();

  for (const { id } of candidates) {
    const claim = await prisma.campaignRecipient.updateMany({
      where: { id, status: CampaignRecipientStatus.PENDING },
      data: { status: CampaignRecipientStatus.SENDING, attempts: { increment: 1 } },
    });
    if (claim.count === 0) continue;

    const recipient = await prisma.campaignRecipient.findUniqueOrThrow({
      where: { id },
      include: { campaign: true, customer: { select: { name: true } } },
    });
    const { campaign } = recipient;

    // The channel lost its configuration mid-campaign: stop cleanly and say why.
    if (!readiness[campaign.channel].ready) {
      await prisma.campaignRecipient.update({ where: { id }, data: { status: CampaignRecipientStatus.PENDING, attempts: { decrement: 1 } } });
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: { status: CampaignStatus.FAILED, lastError: `Channel not ready: ${readiness[campaign.channel].problems.join(', ')}` },
      });
      continue;
    }

    const address = recipient.address;
    const suppressed =
      address &&
      (await prisma.marketingSuppression.findUnique({
        where: { channel_address: { channel: campaign.channel, address } },
        select: { id: true },
      }));
    if (!address || suppressed) {
      await prisma.campaignRecipient.update({
        where: { id },
        data: { status: CampaignRecipientStatus.FAILED, lastError: address ? 'Unsubscribed before sending' : 'No address' },
      });
      continue;
    }

    const cacheKey = `${campaign.id}`;
    let base = valuesCache.get(cacheKey);
    if (!base) {
      base = await renderValues(campaign.branchId, null, campaign.discountCode);
      valuesCache.set(cacheKey, base);
    }
    const values = { ...base, customerName: recipient.customer?.name ?? null };
    const locale = pickLocale(contentOf(campaign), recipient.locale === 'ar' ? 'ar' : 'en');

    try {
      const result =
        campaign.channel === 'EMAIL'
          ? await sendEmail(address, renderEmail(contentOf(campaign), locale, values, unsubscribeUrl(id)), unsubscribeUrl(id))
          : await sendSms(address, renderSms(contentOf(campaign), locale, values));

      await prisma.campaignRecipient.update({
        where: { id },
        data: { status: CampaignRecipientStatus.SENT, sentAt: new Date(), providerMessageId: result.messageId, lastError: null },
      });
    } catch (error) {
      const failure = error instanceof SendFailure ? error : new SendFailure(error instanceof Error ? error.message : String(error), true);
      const retry = failure.transient && recipient.attempts < MAX_ATTEMPTS;

      if (failure.suppress) await suppressAddress(campaign.channel, address, failure.suppress);

      await prisma.campaignRecipient.update({
        where: { id },
        data: retry
          ? { status: CampaignRecipientStatus.PENDING, nextAttemptAt: backoff(recipient.attempts), lastError: failure.message.slice(0, 300) }
          : {
              status: failure.suppress === 'BOUNCED' ? CampaignRecipientStatus.BOUNCED : CampaignRecipientStatus.FAILED,
              lastError: failure.message.slice(0, 300),
            },
      });
    }
  }
}

async function completeFinishedCampaigns() {
  const sending = await prisma.campaign.findMany({ where: { status: CampaignStatus.SENDING }, select: { id: true } });

  for (const { id } of sending) {
    const open = await prisma.campaignRecipient.count({
      where: { campaignId: id, status: { in: [CampaignRecipientStatus.PENDING, CampaignRecipientStatus.SENDING] } },
    });
    if (open === 0) {
      await prisma.campaign.updateMany({
        where: { id, status: CampaignStatus.SENDING },
        data: { status: CampaignStatus.COMPLETED, completedAt: new Date() },
      });
      logger.info({ event: 'campaign.completed', campaignId: id });
    }
  }
}

let running = false;

/** One scheduler tick. Re-entrancy-guarded: a slow batch never overlaps the next. */
export async function runCampaignTick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await startDueCampaigns();
    await failInterruptedSends();
    await deliverBatch();
    await completeFinishedCampaigns();
  } catch (error) {
    logger.error({ event: 'campaign.tick.failed', error: error instanceof Error ? error.message : String(error) });
  } finally {
    running = false;
  }
}

/**
 * Retention: once a campaign has been finished for the configured number of
 * days, erase each recipient's address and error detail. The campaign keeps
 * its counts; the personal data does not outlive its purpose.
 */
export async function pruneCampaignRecipients(): Promise<number> {
  const days = Number(await getSettingValue('campaigns.recipientRetentionDays'));
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const result = await prisma.campaignRecipient.updateMany({
    where: {
      address: { not: null },
      campaign: { completedAt: { lt: cutoff } },
    },
    data: { address: null, lastError: null, providerMessageId: null },
  });
  return result.count;
}

export { suppressAddress };
