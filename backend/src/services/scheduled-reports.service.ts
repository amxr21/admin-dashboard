import { ScheduleFormat, ScheduleFrequency } from '@prisma/client';
import type { Request } from 'express';

import { prisma } from '../db/prisma.js';
import { AppError } from '../errors/AppError.js';
import { audit } from './audit.service.js';
import { sendEmailToRecipients } from './email.service.js';
import { isKnownReportKey, REPORT_REGISTRY, type RangeParams } from './reports.service.js';
import { toCsv } from '../lib/csv.js';
import { toXlsx } from '../lib/xlsx.js';
import { toPdf } from '../lib/pdf.js';

/**
 * Scheduled reports (C3.2) — a recurring send of one report to a recipient
 * list. CRUD lives here; the actual "tick and send" runner lives in
 * `scheduler.ts`, which calls `runScheduledReport` on a timer. Split this
 * way so the run logic is directly unit-testable without a fake clock.
 */

const SCHEDULE_SELECT = {
  id: true,
  reportKey: true,
  frequency: true,
  format: true,
  recipients: true,
  isActive: true,
  lastRunAt: true,
  lastRunStatus: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface ScheduledReportInput {
  reportKey: string;
  frequency: ScheduleFrequency;
  format?: ScheduleFormat;
  recipients: string[];
  isActive?: boolean;
}

function assertKnownReport(reportKey: string): void {
  if (!isKnownReportKey(reportKey)) {
    throw AppError.badRequest(`Unknown report "${reportKey}"`, {
      field: 'reportKey',
      known: Object.keys(REPORT_REGISTRY),
    });
  }
  if (!REPORT_REGISTRY[reportKey]!.isRangeScoped) {
    // A live-state report (needs-attention) has no "last 7 days" to compute
    // — mailing "here's what's stuck right now" on a timer isn't a report,
    // it's spam of the same page every morning.
    throw AppError.badRequest(`"${reportKey}" cannot be scheduled — it has no date range`, {
      field: 'reportKey',
    });
  }
}

function normaliseRecipients(recipients: string[]): string[] {
  // Trimmed, deduped, and validated shape-wise (not deliverability — that's
  // what a real bounce would tell you, which this app has no path to see).
  const cleaned = [...new Set(recipients.map((r) => r.trim()).filter(Boolean))];
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  for (const email of cleaned) {
    if (!EMAIL_RE.test(email)) {
      throw AppError.badRequest(`"${email}" is not a valid email address`, { field: 'recipients' });
    }
  }

  return cleaned;
}

function serialise<T extends { recipients: unknown; createdAt: Date; updatedAt: Date; lastRunAt: Date | null }>(
  row: T,
) {
  return {
    ...row,
    recipients: row.recipients as string[],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
  };
}

export async function listScheduledReports() {
  const rows = await prisma.scheduledReport.findMany({
    select: SCHEDULE_SELECT,
    orderBy: { createdAt: 'desc' },
  });

  return rows.map(serialise);
}

export async function createScheduledReport(
  input: ScheduledReportInput,
  actorId: string,
  req: Request,
) {
  assertKnownReport(input.reportKey);
  const recipients = normaliseRecipients(input.recipients);

  if (recipients.length === 0) {
    throw AppError.badRequest('At least one recipient is required', { field: 'recipients' });
  }

  const row = await prisma.scheduledReport.create({
    data: {
      reportKey: input.reportKey,
      frequency: input.frequency,
      format: input.format ?? ScheduleFormat.CSV,
      recipients,
      isActive: input.isActive ?? true,
      createdById: actorId,
    },
    select: SCHEDULE_SELECT,
  });

  audit(req, {
    action: 'scheduledReport.created',
    entity: 'scheduledReport',
    entityId: row.id,
    changes: { reportKey: { from: null, to: row.reportKey }, frequency: { from: null, to: row.frequency } },
  });

  return serialise(row);
}

export async function updateScheduledReport(
  id: string,
  input: Partial<ScheduledReportInput>,
  req: Request,
) {
  const existing = await prisma.scheduledReport.findUnique({ where: { id }, select: SCHEDULE_SELECT });
  if (!existing) throw AppError.notFound('Scheduled report not found');

  if (input.reportKey !== undefined) assertKnownReport(input.reportKey);
  const recipients = input.recipients !== undefined ? normaliseRecipients(input.recipients) : undefined;
  if (recipients !== undefined && recipients.length === 0) {
    throw AppError.badRequest('At least one recipient is required', { field: 'recipients' });
  }

  const row = await prisma.scheduledReport.update({
    where: { id },
    data: {
      ...(input.reportKey !== undefined ? { reportKey: input.reportKey } : {}),
      ...(input.frequency !== undefined ? { frequency: input.frequency } : {}),
      ...(input.format !== undefined ? { format: input.format } : {}),
      ...(recipients !== undefined ? { recipients } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
    select: SCHEDULE_SELECT,
  });

  audit(req, {
    action: 'scheduledReport.updated',
    entity: 'scheduledReport',
    entityId: id,
    changes: {
      ...(input.isActive !== undefined && input.isActive !== existing.isActive
        ? { isActive: { from: existing.isActive, to: input.isActive } }
        : {}),
      ...(input.frequency !== undefined && input.frequency !== existing.frequency
        ? { frequency: { from: existing.frequency, to: input.frequency } }
        : {}),
    },
  });

  return serialise(row);
}

export async function deleteScheduledReport(id: string, req: Request) {
  const existing = await prisma.scheduledReport.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw AppError.notFound('Scheduled report not found');

  await prisma.scheduledReport.delete({ where: { id } });

  audit(req, { action: 'scheduledReport.deleted', entity: 'scheduledReport', entityId: id });
}

/** Local Y-M-D, matching `reports-api.ts`'s own `toIsoDate` on the frontend. */
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The window a frequency implies, ending "now" — see `ScheduledReport`'s
 *  own schema comment for why this is computed fresh each run, never saved. */
function rangeForFrequency(frequency: ScheduleFrequency, now: Date): RangeParams {
  const to = isoDate(now);
  const from = new Date(now);

  if (frequency === ScheduleFrequency.DAILY) from.setDate(from.getDate() - 1);
  else if (frequency === ScheduleFrequency.WEEKLY) from.setDate(from.getDate() - 7);
  else from.setMonth(from.getMonth() - 1);

  return { from: isoDate(from), to };
}

/**
 * Runs ONE schedule right now — fetches its report over the range its
 * frequency implies, builds a CSV, emails it to every recipient, and
 * records the outcome. Called by both `scheduler.ts`'s timer and (for a
 * "send now" manual test button) a route handler directly — same function
 * either way, so a schedule can never behave differently on a timer than it
 * does when a human triggers the same run to check it works.
 *
 * Never throws — same contract as `audit()`/`notify()`: the caller (the
 * cron tick) must keep going to the next schedule even if this one's mail
 * server is down.
 */
export async function runScheduledReport(id: string): Promise<{ sent: boolean; reason?: string }> {
  const schedule = await prisma.scheduledReport.findUnique({ where: { id } });
  if (!schedule) return { sent: false, reason: 'not_found' };

  const entry = REPORT_REGISTRY[schedule.reportKey];
  if (!entry) return { sent: false, reason: 'unknown_report' };

  const range = rangeForFrequency(schedule.frequency, new Date());

  let outcome: { sent: boolean; reason?: string };
  try {
    const result = await entry.fetch(range);
    const rows = entry.rows(result);
    const columns = entry.csvColumns as never;
    const subject = `${entry.label} — ${range.from} to ${range.to}`;
    const body = `Attached: ${entry.label} for ${range.from} to ${range.to}.`;

    // Same column definitions feed every format — see `sendExport` in
    // `reports.route.ts` for why that matters (no drift between formats).
    const attachment = await (async () => {
      switch (schedule.format) {
        case ScheduleFormat.XLSX:
          return {
            filename: `${schedule.reportKey}.xlsx`,
            content: await toXlsx(entry.label, rows, columns),
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          };
        case ScheduleFormat.PDF:
          return {
            filename: `${schedule.reportKey}.pdf`,
            content: await toPdf(entry.label, rows, columns),
            contentType: 'application/pdf',
          };
        case ScheduleFormat.CSV:
        default:
          return {
            filename: `${schedule.reportKey}.csv`,
            content: Buffer.from(toCsv(rows, columns), 'utf-8'),
            contentType: 'text/csv',
          };
      }
    })();

    const recipients = schedule.recipients as string[];
    const sent = await sendEmailToRecipients(recipients, subject, body, [attachment]);

    outcome = sent ? { sent: true } : { sent: false, reason: 'email_not_configured' };
  } catch (error) {
    outcome = { sent: false, reason: error instanceof Error ? error.message : 'unknown_error' };
  }

  await prisma.scheduledReport.update({
    where: { id },
    data: {
      lastRunAt: new Date(),
      lastRunStatus: outcome.sent ? 'SUCCESS' : (outcome.reason ?? 'FAILED').slice(0, 16),
    },
  });

  return outcome;
}

/** Every currently-active schedule whose frequency matches this tick — the
 *  scheduler calls this once per cadence (daily/weekly/monthly), not once
 *  per schedule, so adding a schedule never means adding a new timer. */
export async function dueScheduledReports(frequency: ScheduleFrequency) {
  return prisma.scheduledReport.findMany({
    where: { isActive: true, frequency },
    select: { id: true },
  });
}
