import { prisma } from '../db/prisma.js';
import { logger } from '../logger.js';

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
}
