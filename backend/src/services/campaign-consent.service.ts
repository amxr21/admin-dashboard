import { createHmac, timingSafeEqual } from 'node:crypto';
import { CampaignRecipientStatus, type CampaignChannel, type SuppressionReason } from '@prisma/client';

import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';
import { normaliseAddress, toE164 } from './campaign-audience.service.js';
import { verifyUnsubscribeToken } from './campaign-channels.js';
import { suppressAddress } from './campaign-dispatcher.js';
import { getSettingValue } from './settings.service.js';

/**
 * Withdrawn consent and provider feedback.
 *
 * Every path ends in the same two writes: the address goes on the
 * suppression list (so no future campaign reaches it, whatever happens to
 * the customer row), and the customer's consent for that channel is cleared
 * along with its timestamp and source. Nothing here logs an address.
 */

function withdrawFields(channel: CampaignChannel) {
  return channel === 'EMAIL'
    ? { emailMarketingConsent: false, emailConsentAt: null, emailConsentSource: null }
    : { smsMarketingConsent: false, smsConsentAt: null, smsConsentSource: null };
}

/** An unsubscribe link was used. Returns false for a forged or unknown token. */
export async function unsubscribeByToken(token: string): Promise<boolean> {
  const recipientId = verifyUnsubscribeToken(token);
  if (!recipientId) return false;

  const recipient = await prisma.campaignRecipient.findUnique({
    where: { id: recipientId },
    select: { customerId: true, address: true, campaign: { select: { channel: true } } },
  });
  if (!recipient) return false;

  const channel = recipient.campaign.channel;
  if (recipient.address) await suppressAddress(channel, recipient.address, 'UNSUBSCRIBED');
  if (recipient.customerId) {
    await prisma.customer.update({ where: { id: recipient.customerId }, data: withdrawFields(channel) });
  }

  logger.info({ event: 'campaign.unsubscribed', channel });
  return true;
}

/* ── Twilio ─────────────────────────────────────────────────────────── */

/**
 * Twilio signs each webhook: HMAC-SHA1 over the full URL followed by every
 * POST parameter (sorted, key then value), keyed with the auth token.
 */
export function validTwilioSignature(path: string, params: Record<string, string>, signature: string | undefined): boolean {
  if (!signature || !env.TWILIO_AUTH_TOKEN || !env.PUBLIC_API_URL) return false;

  const payload =
    `${env.PUBLIC_API_URL}${path}` +
    Object.keys(params)
      .sort()
      .map((key) => `${key}${params[key] ?? ''}`)
      .join('');
  const expected = Buffer.from(createHmac('sha1', env.TWILIO_AUTH_TOKEN).update(payload).digest('base64'));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** A delivery report for an SMS we sent. */
export async function recordSmsStatus(messageId: string, status: string, errorCode: string | undefined) {
  const next =
    status === 'delivered'
      ? CampaignRecipientStatus.DELIVERED
      : status === 'undelivered' || status === 'failed'
        ? CampaignRecipientStatus.FAILED
        : null;
  if (!next) return;

  const recipient = await prisma.campaignRecipient.findFirst({
    where: { providerMessageId: messageId },
    select: { id: true, address: true },
  });
  if (!recipient) return;

  await prisma.campaignRecipient.update({
    where: { id: recipient.id },
    data: { status: next, ...(errorCode ? { lastError: `Provider error ${errorCode}` } : {}) },
  });

  // 21610: the handset opted out at the carrier.
  if (errorCode === '21610' && recipient.address) await suppressAddress('SMS', recipient.address, 'UNSUBSCRIBED');
}

const STOP_WORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'ايقاف', 'إيقاف', 'الغاء', 'إلغاء']);

/** An inbound SMS. Opt-out words withdraw SMS consent for that number. */
export async function recordInboundSms(from: string, body: string): Promise<boolean> {
  if (!STOP_WORDS.has(body.trim().toUpperCase())) return false;

  const number = from.startsWith('+') ? from : `+${from.replace(/\D/g, '')}`;
  await suppressAddress('SMS', number, 'UNSUBSCRIBED');

  // Customers keep bare digits; match on the tail, then confirm in E.164.
  const countryCode = String(await getSettingValue('campaigns.defaultCountryCode')).replace(/\D/g, '') || '971';
  const tail = number.replace(/\D/g, '').slice(-9);
  const candidates = await prisma.customer.findMany({
    where: { phoneNormalized: { endsWith: tail } },
    select: { id: true, phoneNormalized: true },
  });
  const matches = candidates.filter((customer) => toE164(customer.phoneNormalized, countryCode) === number);

  if (matches.length) {
    await prisma.customer.updateMany({ where: { id: { in: matches.map((m) => m.id) } }, data: withdrawFields('SMS') });
  }

  logger.info({ event: 'campaign.sms.opted-out', matchedCustomers: matches.length });
  return true;
}

/* ── Email provider events ─────────────────────────────────────────── */

export function validEmailWebhookSecret(provided: string | undefined): boolean {
  if (!env.EMAIL_WEBHOOK_SECRET || !provided) return false;
  const expected = Buffer.from(env.EMAIL_WEBHOOK_SECRET);
  const actual = Buffer.from(provided);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export interface EmailEvent {
  type: 'delivered' | 'bounced' | 'complained' | 'unsubscribed';
  email: string;
  messageId?: string | undefined;
}

/**
 * A provider-neutral email feedback event — whatever relays a provider's
 * bounce/complaint notifications posts them in this shape.
 */
export async function recordEmailEvent(event: EmailEvent) {
  const address = normaliseAddress('EMAIL', event.email);

  if (event.messageId) {
    const status =
      event.type === 'delivered'
        ? CampaignRecipientStatus.DELIVERED
        : event.type === 'bounced'
          ? CampaignRecipientStatus.BOUNCED
          : null;
    if (status) {
      await prisma.campaignRecipient.updateMany({ where: { providerMessageId: event.messageId }, data: { status } });
    }
  }

  const reasons: Partial<Record<EmailEvent['type'], SuppressionReason>> = {
    bounced: 'BOUNCED',
    complained: 'COMPLAINED',
    unsubscribed: 'UNSUBSCRIBED',
  };
  const reason = reasons[event.type];
  if (!reason) return;

  await suppressAddress('EMAIL', address, reason);
  // A complaint or unsubscribe is a withdrawal of consent; a bounce is not,
  // but the suppression alone already stops further sends to that address.
  if (event.type !== 'bounced') {
    await prisma.customer.updateMany({ where: { email: address }, data: withdrawFields('EMAIL') });
  }
}
