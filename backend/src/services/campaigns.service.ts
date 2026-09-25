import { CampaignStatus, Prisma, type CampaignChannel } from '@prisma/client';
import type { Request } from 'express';

import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { countSmsSegments } from '../lib/sms-segments.js';
import { audit } from './audit.service.js';
import { audienceSchema, resolveAudience, type Audience } from './campaign-audience.service.js';
import { channelReadiness, sendEmail, sendSms, SendFailure } from './campaign-channels.js';
import {
  contentProblems,
  pickLocale,
  renderEmail,
  renderSms,
  type CampaignContent,
  type CampaignLocale,
} from './campaign-render.js';
import { getSettingValue } from './settings.service.js';

/**
 * Campaign lifecycle: draft → (scheduled) → sending → completed, or canceled.
 *
 * Only DRAFT and SCHEDULED campaigns can be edited. Starting a campaign
 * freezes its audience into recipient rows in one transaction; from then on
 * the dispatcher (`campaign-dispatcher.ts`) owns delivery. Audit entries name
 * the campaign and counts — never a recipient or the message text.
 */

export interface CampaignInput {
  name: string;
  channel: CampaignChannel;
  subjectEn?: string | null | undefined;
  subjectAr?: string | null | undefined;
  bodyEn?: string | null | undefined;
  bodyAr?: string | null | undefined;
  discountCode?: string | null | undefined;
  branchId?: string | null | undefined;
  audience: Audience;
}

const EDITABLE: CampaignStatus[] = [CampaignStatus.DRAFT, CampaignStatus.SCHEDULED];

function contentOf(campaign: CampaignContent): CampaignContent {
  return {
    subjectEn: campaign.subjectEn,
    subjectAr: campaign.subjectAr,
    bodyEn: campaign.bodyEn,
    bodyAr: campaign.bodyAr,
  };
}

async function statsFor(campaignIds: string[]) {
  const rows = campaignIds.length
    ? await prisma.campaignRecipient.groupBy({
        by: ['campaignId', 'status'],
        where: { campaignId: { in: campaignIds } },
        _count: { _all: true },
      })
    : [];

  const stats = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const entry = stats.get(row.campaignId) ?? {};
    entry[row.status] = row._count._all;
    stats.set(row.campaignId, entry);
  }
  return stats;
}

type CampaignRow = Prisma.CampaignGetPayload<object>;

function serialize(campaign: CampaignRow, counts: Record<string, number> = {}) {
  return {
    id: campaign.id,
    name: campaign.name,
    channel: campaign.channel,
    status: campaign.status,
    subjectEn: campaign.subjectEn,
    subjectAr: campaign.subjectAr,
    bodyEn: campaign.bodyEn,
    bodyAr: campaign.bodyAr,
    discountCode: campaign.discountCode,
    branchId: campaign.branchId,
    audience: campaign.audience as Audience,
    scheduledAt: campaign.scheduledAt?.toISOString() ?? null,
    startedAt: campaign.startedAt?.toISOString() ?? null,
    completedAt: campaign.completedAt?.toISOString() ?? null,
    audienceSize: campaign.audienceSize,
    lastError: campaign.lastError,
    createdAt: campaign.createdAt.toISOString(),
    updatedAt: campaign.updatedAt.toISOString(),
    outcomes: {
      pending: (counts.PENDING ?? 0) + (counts.SENDING ?? 0),
      sent: counts.SENT ?? 0,
      delivered: counts.DELIVERED ?? 0,
      failed: counts.FAILED ?? 0,
      bounced: counts.BOUNCED ?? 0,
    },
  };
}

export type CampaignView = ReturnType<typeof serialize>;

export async function listCampaigns() {
  const campaigns = await prisma.campaign.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  const stats = await statsFor(campaigns.map((campaign) => campaign.id));
  return campaigns.map((campaign) => serialize(campaign, stats.get(campaign.id)));
}

async function findCampaign(id: string) {
  const campaign = await prisma.campaign.findUnique({ where: { id } });
  if (!campaign) throw AppError.notFound('Campaign not found');
  return campaign;
}

export async function getCampaign(id: string) {
  const campaign = await findCampaign(id);
  const stats = await statsFor([id]);
  return serialize(campaign, stats.get(id));
}

function writeData(input: CampaignInput) {
  const trimmed = (value: string | null | undefined) => (value?.trim() ? value.trim() : null);
  return {
    name: input.name.trim(),
    channel: input.channel,
    // SMS has no subject; storing one would suggest it is sent.
    subjectEn: input.channel === 'EMAIL' ? trimmed(input.subjectEn) : null,
    subjectAr: input.channel === 'EMAIL' ? trimmed(input.subjectAr) : null,
    bodyEn: trimmed(input.bodyEn),
    bodyAr: trimmed(input.bodyAr),
    discountCode: trimmed(input.discountCode),
    branchId: input.branchId ?? null,
    audience: audienceSchema.parse(input.audience) as Prisma.InputJsonValue,
  };
}

export async function createCampaign(input: CampaignInput, req: Request) {
  const campaign = await prisma.campaign.create({
    data: { ...writeData(input), createdById: req.user?.id ?? null },
  });
  audit(req, { action: 'campaign.create', entity: 'campaigns', entityId: campaign.id, changes: { channel: { to: campaign.channel } } });
  return serialize(campaign);
}

export async function updateCampaign(id: string, input: CampaignInput, req: Request) {
  const existing = await findCampaign(id);
  if (!EDITABLE.includes(existing.status)) {
    throw AppError.conflict(`A ${existing.status.toLowerCase()} campaign can no longer be edited`);
  }

  const campaign = await prisma.campaign.update({ where: { id }, data: writeData(input) });
  audit(req, { action: 'campaign.update', entity: 'campaigns', entityId: id, changes: null });
  return serialize(campaign);
}

export async function deleteCampaign(id: string, req: Request) {
  const existing = await findCampaign(id);
  if (existing.status !== CampaignStatus.DRAFT && existing.status !== CampaignStatus.CANCELED) {
    throw AppError.conflict('Only a draft or canceled campaign can be deleted');
  }
  await prisma.campaign.delete({ where: { id } });
  audit(req, { action: 'campaign.delete', entity: 'campaigns', entityId: id, changes: null });
}

/** Cost of one SMS campaign, from the longest rendering of the message. */
function smsEstimate(content: CampaignContent, recipients: number, costPerSegment: number) {
  const sample = { customerName: 'Mohammed Abdullah', storeName: 'Store', branchName: null, discountCode: 'CODE12345' };
  const segments = Math.max(
    ...(['en', 'ar'] as const)
      .filter((locale) => (locale === 'ar' ? content.bodyAr : content.bodyEn)?.trim())
      .map((locale) => countSmsSegments(renderSms(content, locale, sample)).segments),
    0,
  );
  return {
    segmentsPerMessage: segments,
    totalSegments: segments * recipients,
    estimatedCost: costPerSegment > 0 ? (segments * recipients * costPerSegment).toFixed(2) : null,
  };
}

export async function previewAudience(channel: CampaignChannel, audienceInput: unknown, content: CampaignContent) {
  const audience = audienceSchema.parse(audienceInput);
  const result = await resolveAudience(channel, audience);
  const costPerSegment = Number(await getSettingValue('campaigns.smsCostPerSegment'));

  return {
    matched: result.matched,
    eligible: result.eligible.length,
    excluded: result.excluded,
    sample: result.eligible.slice(0, 5).map((member) => member.name),
    sms: channel === 'SMS' ? smsEstimate(content, result.eligible.length, costPerSegment) : null,
    largeAudienceThreshold: Number(await getSettingValue('campaigns.largeAudienceThreshold')),
  };
}

async function renderValues(branchId: string | null, customerName: string | null, discountCode: string | null) {
  const [storeName, branch] = await Promise.all([
    getSettingValue('store.name'),
    branchId ? prisma.branch.findUnique({ where: { id: branchId }, select: { name: true } }) : null,
  ]);
  return { customerName, storeName: String(storeName || 'our store'), branchName: branch?.name ?? null, discountCode };
}

async function defaultLocale(): Promise<CampaignLocale> {
  return String(await getSettingValue('ui.defaultLocale')) === 'ar' ? 'ar' : 'en';
}

/**
 * Send one copy to the person testing it — never to a customer, and never
 * recorded as a recipient. Email goes to the signed-in user's own address;
 * SMS to the number they type.
 */
export async function testSend(id: string, to: { phone?: string | undefined }, req: Request) {
  const campaign = await findCampaign(id);
  const problems = contentProblems(campaign.channel, contentOf(campaign));
  if (problems.length) throw AppError.badRequest(problems.join('. '), { field: 'content' });

  const readiness = (await channelReadiness())[campaign.channel];
  if (!readiness.ready) throw AppError.badRequest('This channel is not set up yet', { problems: readiness.problems });

  const locale = pickLocale(contentOf(campaign), await defaultLocale());
  const values = await renderValues(campaign.branchId, req.user?.name ?? null, campaign.discountCode);

  try {
    if (campaign.channel === 'EMAIL') {
      const address = req.user?.email;
      if (!address) throw AppError.badRequest('Your account has no email address to test with');
      // The test copy's unsubscribe link is inert: it names no recipient row.
      const url = `${env.PUBLIC_API_URL ?? ''}/unsubscribe?token=test`;
      await sendEmail(address, renderEmail(contentOf(campaign), locale, values, url), url);
    } else {
      if (!to.phone) throw AppError.badRequest('Enter your phone number for the test', { field: 'phone' });
      await sendSms(to.phone, renderSms(contentOf(campaign), locale, values));
    }
  } catch (error) {
    if (error instanceof SendFailure) throw AppError.badRequest(`The test did not send: ${error.message}`);
    throw error;
  }

  audit(req, { action: 'campaign.test-send', entity: 'campaigns', entityId: id, changes: null });
}

/**
 * Queue a campaign to send now or at `sendAt`.
 *
 * A large audience needs the sender to type the exact number of recipients —
 * a confirmation that cannot be clicked through by habit.
 */
export async function scheduleCampaign(
  id: string,
  input: { sendAt?: string | undefined; confirmRecipients?: number | undefined },
  req: Request,
) {
  const campaign = await findCampaign(id);
  if (!EDITABLE.includes(campaign.status)) {
    throw AppError.conflict(`A ${campaign.status.toLowerCase()} campaign cannot be sent again`);
  }

  const problems = contentProblems(campaign.channel, contentOf(campaign));
  if (problems.length) throw AppError.badRequest(problems.join('. '), { field: 'content' });

  const readiness = (await channelReadiness())[campaign.channel];
  if (!readiness.ready) throw AppError.badRequest('This channel is not set up yet', { problems: readiness.problems });

  const audience = await resolveAudience(campaign.channel, audienceSchema.parse(campaign.audience));
  if (audience.eligible.length === 0) {
    throw AppError.badRequest('No customer in this audience can receive this campaign', { excluded: audience.excluded });
  }

  const threshold = Number(await getSettingValue('campaigns.largeAudienceThreshold'));
  if (audience.eligible.length >= threshold && input.confirmRecipients !== audience.eligible.length) {
    throw AppError.badRequest(`Type ${String(audience.eligible.length)} to confirm sending to that many customers`, {
      field: 'confirmRecipients',
      required: audience.eligible.length,
    });
  }

  const sendAt = input.sendAt ? new Date(input.sendAt) : null;
  if (sendAt && Number.isNaN(sendAt.getTime())) throw AppError.badRequest('Choose a valid send time', { field: 'sendAt' });

  if (sendAt && sendAt.getTime() > Date.now() + 60_000) {
    const scheduled = await prisma.campaign.update({
      where: { id },
      data: { status: CampaignStatus.SCHEDULED, scheduledAt: sendAt, lastError: null },
    });
    audit(req, { action: 'campaign.schedule', entity: 'campaigns', entityId: id, changes: { scheduledAt: { to: sendAt.toISOString() } } });
    return serialize(scheduled);
  }

  const started = await startCampaign(id);
  audit(req, { action: 'campaign.send', entity: 'campaigns', entityId: id, changes: { audienceSize: { to: started.audienceSize } } });
  return serialize(started);
}

/**
 * Freeze the audience into recipient rows and hand over to the dispatcher.
 *
 * The status flip is conditional on the campaign still being DRAFT or
 * SCHEDULED, inside the same transaction as the inserts — two concurrent
 * starts (a double click, the scheduler and a person) cannot both queue it.
 * `skipDuplicates` plus the (campaign, customer) unique key is the second
 * line of defence.
 */
export async function startCampaign(id: string) {
  const campaign = await findCampaign(id);
  const audience = await resolveAudience(campaign.channel, audienceSchema.parse(campaign.audience));
  const locale = await defaultLocale();

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.campaign.updateMany({
      where: { id, status: { in: EDITABLE } },
      data: {
        status: CampaignStatus.SENDING,
        startedAt: new Date(),
        audienceSize: audience.eligible.length,
        lastError: null,
      },
    });
    if (claimed.count === 0) throw AppError.conflict('This campaign has already started');

    await tx.campaignRecipient.createMany({
      data: audience.eligible.map((member) => ({
        campaignId: id,
        customerId: member.customerId,
        address: member.address,
        locale,
      })),
      skipDuplicates: true,
    });

    return tx.campaign.findUniqueOrThrow({ where: { id } });
  });
}

export async function cancelCampaign(id: string, req: Request) {
  const campaign = await findCampaign(id);
  const cancellable: CampaignStatus[] = [CampaignStatus.DRAFT, CampaignStatus.SCHEDULED, CampaignStatus.SENDING];
  if (!cancellable.includes(campaign.status)) {
    throw AppError.conflict(`A ${campaign.status.toLowerCase()} campaign cannot be canceled`);
  }

  // Messages already handed to a provider cannot be recalled; everything
  // still queued simply never leaves (the dispatcher skips canceled campaigns).
  const updated = await prisma.campaign.update({
    where: { id },
    data: { status: CampaignStatus.CANCELED, completedAt: new Date() },
  });
  audit(req, { action: 'campaign.cancel', entity: 'campaigns', entityId: id, changes: null });
  const stats = await statsFor([id]);
  return serialize(updated, stats.get(id));
}

export { renderValues, contentOf, defaultLocale };
