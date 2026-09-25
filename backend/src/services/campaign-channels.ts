import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CampaignChannel, SuppressionReason } from '@prisma/client';

import { env } from '../config/env.js';
import { getEmailDeliveryReadiness, sendMarketingEmail } from './email.service.js';
import type { RenderedEmail } from './campaign-render.js';

/**
 * The two ways a campaign leaves the building, behind one interface.
 *
 * Email rides the SMTP setup the app already has. SMS is Twilio over its REST
 * API (no SDK — one form POST). Every credential comes from the environment;
 * none is ever stored in the database or returned to a browser.
 */

export type ChannelProblem = 'publicUrlMissing' | 'emailNotConfigured' | 'smsNotConfigured';

export interface ChannelReadiness {
  ready: boolean;
  problems: ChannelProblem[];
}

export async function channelReadiness(): Promise<Record<CampaignChannel, ChannelReadiness>> {
  const email = await getEmailDeliveryReadiness();
  const emailProblems: ChannelProblem[] = [];
  if (!email.configured) emailProblems.push('emailNotConfigured');
  // Every marketing email carries an unsubscribe link, which needs a public URL.
  if (!env.PUBLIC_API_URL) emailProblems.push('publicUrlMissing');

  const smsProblems: ChannelProblem[] = [];
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM) smsProblems.push('smsNotConfigured');

  return {
    EMAIL: { ready: emailProblems.length === 0, problems: emailProblems },
    SMS: { ready: smsProblems.length === 0, problems: smsProblems },
  };
}

/**
 * Why a send failed, in the terms the dispatcher acts on: retry later, give
 * up, or give up AND never message this address again.
 */
export class SendFailure extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
    readonly suppress: SuppressionReason | null = null,
  ) {
    super(message);
  }
}

export async function sendEmail(to: string, email: RenderedEmail, unsubscribeUrl: string) {
  try {
    return await sendMarketingEmail({ to, ...email, unsubscribeUrl });
  } catch (error) {
    const code = Number((error as { responseCode?: unknown }).responseCode ?? 0);
    const message = error instanceof Error ? error.message : String(error);
    if ((error as { notConfigured?: boolean }).notConfigured) throw new SendFailure(message, false);
    // SMTP 4xx is "try again later"; 5xx is final. 550/551/553 name a mailbox
    // that does not exist — a hard bounce, never to be retried.
    if (code >= 400 && code < 500) throw new SendFailure(message, true);
    if ([550, 551, 553].includes(code)) throw new SendFailure(message, false, 'BOUNCED');
    if (code >= 500) throw new SendFailure(message, false);
    // No SMTP code: a connection-level failure, worth another attempt.
    throw new SendFailure(message, true);
  }
}

export async function sendSms(to: string, body: string): Promise<{ messageId: string | null }> {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM) {
    throw new SendFailure('SMS is not configured', false);
  }

  const form = new URLSearchParams({ To: to, From: env.TWILIO_FROM, Body: body });
  if (env.PUBLIC_API_URL) form.set('StatusCallback', `${env.PUBLIC_API_URL}/webhooks/sms/status`);

  let response: Response;
  try {
    response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.TWILIO_ACCOUNT_SID)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form,
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch (error) {
    throw new SendFailure(error instanceof Error ? error.message : 'SMS provider unreachable', true);
  }

  const payload = (await response.json().catch(() => ({}))) as { sid?: string; code?: number; message?: string };

  if (response.ok) return { messageId: payload.sid ?? null };

  const message = payload.message ?? `SMS provider returned ${String(response.status)}`;
  // 21610: the number replied STOP at the carrier — honour it here too.
  if (payload.code === 21610) throw new SendFailure(message, false, 'UNSUBSCRIBED');
  if (response.status === 429 || response.status >= 500) throw new SendFailure(message, true);
  throw new SendFailure(message, false);
}

/* ── Unsubscribe links ─────────────────────────────────────────────────
 * The link names the recipient row and carries an HMAC over it, so it
 * cannot be forged or pointed at someone else, and needs no login. Keyed off
 * JWT_SECRET with a purpose label, so a token for this can never be replayed
 * as anything else the app signs with the same key.
 */

function signature(recipientId: string): string {
  return createHmac('sha256', `${env.JWT_SECRET}:campaign-unsubscribe`).update(recipientId).digest('base64url');
}

export function unsubscribeToken(recipientId: string): string {
  return `${recipientId}.${signature(recipientId)}`;
}

export function unsubscribeUrl(recipientId: string): string {
  return `${env.PUBLIC_API_URL ?? ''}/unsubscribe?token=${encodeURIComponent(unsubscribeToken(recipientId))}`;
}

/** The recipient id a token names, or null when it was not signed by us. */
export function verifyUnsubscribeToken(token: string): string | null {
  const [recipientId, provided] = token.split('.');
  if (!recipientId || !provided) return null;

  const expected = Buffer.from(signature(recipientId));
  const actual = Buffer.from(provided);
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? recipientId : null;
}
