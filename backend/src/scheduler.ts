import cron from 'node-cron';
import { ScheduleFrequency } from '@prisma/client';

import { logger } from './logger.js';
import { dueScheduledReports, runScheduledReport } from './services/scheduled-reports.service.js';

/**
 * The scheduled-reports ticker (C3.2).
 *
 * ─── IN-PROCESS, NOT A SEPARATE WORKER ────────────────────────────────
 * `render.yaml` defines one web service and no Render Cron Job — adding a
 * second service is a deploy/billing decision, not a code one, so this runs
 * inside the same process as the API. That is a real limitation, not an
 * oversight: if this app is ever scaled to multiple instances, every
 * instance would tick independently and a schedule would send once PER
 * INSTANCE, not once total. Fine for the single-instance deploy this app
 * actually runs today; the moment a second instance is added, this needs to
 * move to a real job queue (BullMQ + Redis, or a Render Cron Job service)
 * with a single active worker. Flagged here, not silently left to surprise
 * whoever adds that second instance.
 *
 * ─── WHY EVERY DAY AT 06:00, NOT "WHENEVER THE HOUR MATCHES SCHEDULE.frequency" ──
 * Three fixed cron expressions (daily, weekly, monthly), not one per saved
 * schedule — adding a hundred scheduled reports must not mean a hundred
 * timers. Each tick asks the DB "which active schedules match THIS
 * cadence" and runs all of them, so the timer count stays fixed at 3
 * regardless of how many schedules exist.
 *
 * ─── NEVER THROWS OUT OF THE TICK ─────────────────────────────────────
 * `runScheduledReport` already never throws (same contract as
 * `audit()`/`notify()`), but the loop itself is defensive too — one
 * schedule's unexpected failure must not stop the rest of that tick's
 * batch from running.
 */

async function runDue(frequency: ScheduleFrequency): Promise<void> {
  const due = await dueScheduledReports(frequency);

  if (due.length === 0) return;

  logger.info({ event: 'scheduledReports.tick.started', frequency, count: due.length });

  for (const { id } of due) {
    try {
      const outcome = await runScheduledReport(id);
      logger.info({ event: 'scheduledReports.run.completed', scheduleId: id, ...outcome });
    } catch (error) {
      // Should be unreachable — runScheduledReport catches internally — but
      // a scheduler loop is exactly the place "should be unreachable" is
      // cheap insurance against, not a place to find out the hard way.
      logger.error({
        event: 'scheduledReports.run.unexpectedError',
        scheduleId: id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** Started once from `server.ts`. Times are UTC — the same server-clock
 *  discipline every other date computation in this backend already uses
 *  (see `reports.service.ts`'s own range handling). */
export function startScheduler(): void {
  // 06:00 UTC daily — covers the daily cadence directly, and IS the one
  // tick-of-the-day weekly/monthly schedules also fire from (a weekly
  // schedule doesn't need its own separate time-of-day, just a day-of-week
  // gate before asking the DB).
  cron.schedule('0 6 * * *', () => {
    void runDue(ScheduleFrequency.DAILY);
    // Monday.
    if (new Date().getUTCDay() === 1) void runDue(ScheduleFrequency.WEEKLY);
    // First of the month.
    if (new Date().getUTCDate() === 1) void runDue(ScheduleFrequency.MONTHLY);
  });

  logger.info({ event: 'scheduledReports.scheduler.started' });
}
