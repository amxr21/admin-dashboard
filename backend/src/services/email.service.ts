import nodemailer, { type Transporter } from 'nodemailer';

import { env } from '../config/env.js';
import { logger } from '../logger.js';
import { getSettingValue } from './settings.service.js';

/**
 * Outgoing alert email — the ESP integration CLAUDE.md tracked as "not
 * started" for the notification-preferences toggles to fully mean what they
 * imply. Plain SMTP via `nodemailer` rather than a specific vendor SDK
 * (Resend, SendGrid, ...): this is a plug-and-play template for ANY
 * business, and SMTP is the one transport every mail provider speaks,
 * including a business's own mail server.
 *
 * ─── SAME "NEVER THROWS" SHAPE AS notify()/audit() ───────────────────
 * A failed email must not fail the write that triggered it — a low-stock
 * notification has to be recorded whether or not the mail server is
 * reachable right now. Every failure here is caught and logged loudly by
 * the caller (`notify.service.ts`), never allowed to propagate.
 *
 * ─── WHY CONFIGURATION IS CHECKED, NOT ASSUMED ───────────────────────
 * Three independent things all have to be true before an email can go out:
 * the SMTP env vars are set, `email.enabled` is on, and `email.fromAddress`
 * is filled in. Any one missing means "not configured", the same
 * non-error, non-crash outcome `upload.service.ts` uses for Cloudinary.
 */

let transporter: Transporter | null = null;

export type EmailReadinessCode =
  | 'ready'
  | 'disabled'
  | 'missingSender'
  | 'smtpPartial'
  | 'smtpMissing';

export interface EmailDeliveryReadiness {
  configured: boolean;
  partial: boolean;
  readinessCode: EmailReadinessCode;
}

interface ResolvedEmailDeliveryConfiguration extends EmailDeliveryReadiness {
  fromAddress: string;
  /** Display name beside the address, or `''` to send the bare address. */
  senderName: string;
  /** `''` means "omit the header" — see `buildFrom`/`replyToHeader` below. */
  replyToAddress: string;
}

/**
 * `"Nour Coffee" <alerts@…>` when a sender name is set, the bare address
 * otherwise.
 *
 * The name is QUOTED because a display name containing a comma or a period
 * ("Nour Coffee, Ltd.") is otherwise parsed as an address-list separator by
 * RFC 5322, which turns one recipient header into two malformed ones. Any
 * quote inside the name is escaped for the same reason. A store cannot type
 * a name that breaks its own alert emails.
 */
export function buildFrom(fromAddress: string, senderName: string): string {
  if (!senderName) return fromAddress;
  return `"${senderName.replace(/(["\\])/g, '\\$1')}" <${fromAddress}>`;
}

export function deriveEmailDeliveryReadiness(
  smtpVars: readonly unknown[],
  enabled: boolean,
  fromAddress: string,
): EmailDeliveryReadiness {
  const smtpConfigured = smtpVars.every(Boolean);
  const smtpPartiallyConfigured = smtpVars.some(Boolean) && !smtpConfigured;

  if (smtpPartiallyConfigured) {
    return { configured: false, partial: true, readinessCode: 'smtpPartial' };
  }
  if (!smtpConfigured) {
    return {
      configured: false,
      partial: Boolean(enabled || fromAddress),
      readinessCode: 'smtpMissing',
    };
  }
  if (!fromAddress) {
    return { configured: false, partial: true, readinessCode: 'missingSender' };
  }
  if (!enabled) {
    return { configured: false, partial: false, readinessCode: 'disabled' };
  }

  return { configured: true, partial: false, readinessCode: 'ready' };
}

async function resolveEmailDeliveryConfiguration(): Promise<ResolvedEmailDeliveryConfiguration> {
  const smtpVars = [env.SMTP_HOST, env.SMTP_PORT, env.SMTP_USER, env.SMTP_PASSWORD];
  const [enabled, fromAddress, senderName, replyToAddress] = await Promise.all([
    getSettingValue('email.enabled'),
    getSettingValue('email.fromAddress'),
    getSettingValue('email.senderName'),
    getSettingValue('email.replyToAddress'),
  ]);

  return {
    // Readiness deliberately does NOT consider the sender name or reply-to:
    // both are presentation, and an empty one has a defined meaning (bare
    // address / replies to the from-address). Folding them in would report
    // a working deployment as unconfigured for leaving an optional field blank.
    ...deriveEmailDeliveryReadiness(smtpVars, enabled, fromAddress),
    fromAddress,
    senderName,
    replyToAddress,
  };
}

/**
 * Single readiness contract shared by delivery and diagnostics.
 *
 * Keeping this beside the sender prevents the configuration page from
 * declaring email ready using a weaker subset of the conditions that the
 * actual delivery path enforces.
 */
export async function getEmailDeliveryReadiness(): Promise<EmailDeliveryReadiness> {
  const configuration = await resolveEmailDeliveryConfiguration();
  return {
    configured: configuration.configured,
    partial: configuration.partial,
    readinessCode: configuration.readinessCode,
  };
}

function getTransporter(): Transporter | null {
  if (transporter) return transporter;
  if (!env.SMTP_HOST || !env.SMTP_PORT || !env.SMTP_USER || !env.SMTP_PASSWORD) return null;

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    // 465 is the implicit-TLS port; everything else (587, 25, ...) negotiates
    // STARTTLS instead. Hardcoding `true` would break the far more common
    // 587 setup silently.
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
  });

  return transporter;
}

/**
 * Sends one alert email to the store's support address.
 *
 * Never throws. Logs a `debug`-level skip when unconfigured (expected, not
 * an error) and an `error`-level failure if a configured send actually fails
 * (a real problem worth noticing, same distinction `audit.service.ts` draws).
 */
export async function sendAlertEmail(subject: string, body: string): Promise<void> {
  const [configuration, toAddress] = await Promise.all([
    resolveEmailDeliveryConfiguration(),
    getSettingValue('store.supportEmail'),
  ]);
  const client = configuration.configured ? getTransporter() : null;

  if (!client || !configuration.fromAddress || !toAddress) {
    logger.debug({
      event: 'email.alert.skipped',
      reason: !configuration.configured ? configuration.readinessCode : 'missing_recipient',
    });
    return;
  }

  try {
    await client.sendMail({
      from: buildFrom(configuration.fromAddress, configuration.senderName),
      to: toAddress,
      subject,
      text: body,
      // Spread rather than `replyTo: x || undefined`: an empty Reply-To
      // header is handled inconsistently across mail servers and some drop
      // the message, so a blank setting omits the header entirely and lets
      // the client's own default (reply to the sender) apply.
      ...(configuration.replyToAddress ? { replyTo: configuration.replyToAddress } : {}),
    });

    logger.info({ event: 'email.alert.sent', subject });
  } catch (error) {
    logger.error({
      event: 'email.alert.failed',
      subject,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

/**
 * Sends to an arbitrary recipient list — C3.2's scheduled reports, the first
 * caller that needs more than the one fixed `store.supportEmail` address
 * `sendAlertEmail` hardcodes. Kept as a SEPARATE function rather than adding
 * a `to?` override there: `sendAlertEmail`'s callers (`notify.service.ts`,
 * inventory/return alerts) are all genuinely "notify the store", and giving
 * that function a variable audience would make it too easy for a future
 * caller to accidentally mail an external address using the internal-alert
 * code path.
 *
 * Same "never throws, checked not assumed" contract as `sendAlertEmail`:
 * SMTP configured, `email.enabled` on, `fromAddress` set — any one missing
 * is "not configured", not an error. An empty recipient list is also a
 * no-op, not a send-to-nobody error, since the caller (a schedule with a
 * cleared recipients field) has already decided nothing should go out.
 */
export async function sendEmailToRecipients(
  recipients: readonly string[],
  subject: string,
  body: string,
  attachments: readonly EmailAttachment[] = [],
): Promise<boolean> {
  if (recipients.length === 0) {
    logger.debug({ event: 'email.recipients.skipped', reason: 'no_recipients' });
    return false;
  }

  const configuration = await resolveEmailDeliveryConfiguration();
  const client = configuration.configured ? getTransporter() : null;

  if (!client || !configuration.fromAddress) {
    logger.debug({
      event: 'email.recipients.skipped',
      reason: configuration.readinessCode,
    });
    return false;
  }

  try {
    await client.sendMail({
      from: buildFrom(configuration.fromAddress, configuration.senderName),
      to: recipients.join(', '),
      subject,
      text: body,
      // Same omit-when-blank rule as `sendAlertEmail` — a scheduled report
      // is the case where a reply most needs somewhere real to land.
      ...(configuration.replyToAddress ? { replyTo: configuration.replyToAddress } : {}),
      attachments: attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });

    logger.info({ event: 'email.recipients.sent', subject, recipientCount: recipients.length });
    return true;
  } catch (error) {
    logger.error({
      event: 'email.recipients.failed',
      subject,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * One marketing email to one customer — the campaign sender's transport.
 *
 * Unlike the alert senders this THROWS, with the SMTP reply code attached,
 * because the campaign dispatcher needs to tell a temporary refusal (4xx:
 * retry later) from a permanent one (5xx: stop, and suppress on a hard
 * bounce). Carries RFC 8058 one-click unsubscribe headers so mail clients can
 * offer their own Unsubscribe button.
 */
export async function sendMarketingEmail(message: {
  to: string;
  subject: string;
  html: string;
  text: string;
  unsubscribeUrl: string;
}): Promise<{ messageId: string | null }> {
  const configuration = await resolveEmailDeliveryConfiguration();
  const client = configuration.configured ? getTransporter() : null;

  if (!client || !configuration.fromAddress) {
    throw Object.assign(new Error(`Email is not configured (${configuration.readinessCode})`), {
      responseCode: 0,
      notConfigured: true,
    });
  }

  const info = (await client.sendMail({
    from: buildFrom(configuration.fromAddress, configuration.senderName),
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
    ...(configuration.replyToAddress ? { replyTo: configuration.replyToAddress } : {}),
    headers: {
      'List-Unsubscribe': `<${message.unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  })) as { messageId?: string };

  return { messageId: info.messageId ?? null };
}