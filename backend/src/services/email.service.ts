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
  const client = getTransporter();

  if (!client) {
    logger.debug({ event: 'email.alert.skipped', reason: 'smtp_not_configured' });
    return;
  }

  const [enabled, fromAddress, toAddress] = await Promise.all([
    getSettingValue('email.enabled'),
    getSettingValue('email.fromAddress'),
    getSettingValue('store.supportEmail'),
  ]);

  if (!enabled || !fromAddress || !toAddress) {
    logger.debug({ event: 'email.alert.skipped', reason: 'not_enabled_or_incomplete' });
    return;
  }

  try {
    await client.sendMail({
      from: fromAddress,
      to: toAddress,
      subject,
      text: body,
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

  const client = getTransporter();

  if (!client) {
    logger.debug({ event: 'email.recipients.skipped', reason: 'smtp_not_configured' });
    return false;
  }

  const [enabled, fromAddress] = await Promise.all([
    getSettingValue('email.enabled'),
    getSettingValue('email.fromAddress'),
  ]);

  if (!enabled || !fromAddress) {
    logger.debug({ event: 'email.recipients.skipped', reason: 'not_enabled_or_incomplete' });
    return false;
  }

  try {
    await client.sendMail({
      from: fromAddress,
      to: recipients.join(', '),
      subject,
      text: body,
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
