import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';
import { sendAlertEmail } from './email.service.js';

/**
 * In-app staff notifications.
 *
 * ─── SAME "NEVER THROWS" SHAPE AS audit() ────────────────────────────
 * A failed notification write must not fail the operation that triggered it
 * — a stock adjustment has to succeed whether or not anyone gets told about
 * it. Every failure is swallowed and logged loudly, exactly like
 * `audit.service.ts`. See that file for the fuller reasoning.
 *
 * ─── NO PER-USER TARGETING ────────────────────────────────────────────
 * `Notification` has no recipient column — it is a single shared inbox for
 * "dashboard staff", read by the bell in the top bar. One row reaches
 * everyone who can see it; there is no fan-out to compute here.
 *
 * ─── EMAIL RIDES ALONG HERE, NOT AT EACH CALL SITE ───────────────────
 * `notify()` is the one funnel every alert already goes through (low stock,
 * return requests, ...), so hooking the optional email send in here means
 * every existing AND future caller gets it for free, gated by the same
 * `email.enabled` setting — see email.service.ts for why that check (and
 * the SMTP send itself) never throws back into this "never throws" function.
 */

export interface NotifyInput {
  /** Short machine-readable kind, e.g. 'inventory.low-stock', 'return.requested'. */
  type: string;
  title: string;
  body?: string | undefined;
  /** In-app deep link, e.g. '/admin/inventory'. */
  link?: string | undefined;
}

/** Fire-and-forget by design — see the note above. */
export function notify(entry: NotifyInput): void {
  void prisma.notification
    .create({
      data: {
        type: entry.type,
        title: entry.title,
        body: entry.body ?? null,
        link: entry.link ?? null,
      },
    })
    .catch((error: unknown) => {
      logger.error({
        event: 'notification.write.failed',
        type: entry.type,
        error: error instanceof Error ? error.message : String(error),
      });
    });

  // Independent of the write above succeeding or failing — the in-app row
  // and the email are two separate best-effort side channels, neither
  // gated on the other.
  void sendAlertEmail(entry.title, entry.body ?? entry.title);
}
