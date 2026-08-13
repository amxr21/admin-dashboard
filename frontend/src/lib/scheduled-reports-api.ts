import { apiFetch } from '@/lib/api';

/**
 * Client for `/api/v1/scheduled-reports` (C3.2) — a recurring send of one
 * report to a recipient list. Separate from `reports-api.ts`: that file
 * fetches report DATA, this manages the recurring-send RESOURCE, the same
 * split `staff-api.ts` vs. a report-fetching client would draw.
 */

export type ScheduleFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';
export type ScheduleFormat = 'CSV' | 'XLSX' | 'PDF';

export interface ScheduledReport {
  id: string;
  reportKey: string;
  frequency: ScheduleFrequency;
  format: ScheduleFormat;
  recipients: string[];
  isActive: boolean;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledReportInput {
  reportKey: string;
  frequency: ScheduleFrequency;
  format?: ScheduleFormat;
  recipients: string[];
  isActive?: boolean;
}

export async function fetchScheduledReports(): Promise<ScheduledReport[]> {
  return apiFetch<ScheduledReport[]>('/scheduled-reports');
}

export async function createScheduledReport(input: ScheduledReportInput): Promise<ScheduledReport> {
  return apiFetch<ScheduledReport>('/scheduled-reports', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateScheduledReport(
  id: string,
  input: Partial<ScheduledReportInput>,
): Promise<ScheduledReport> {
  return apiFetch<ScheduledReport>(`/scheduled-reports/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deleteScheduledReport(id: string): Promise<void> {
  await apiFetch<void>(`/scheduled-reports/${id}`, { method: 'DELETE' });
}

export interface SendNowOutcome {
  sent: boolean;
  reason?: string;
}

/** Manual test send — runs the schedule right now instead of waiting for
 *  its next real tick. Same underlying function the cron ticker calls. */
export async function sendScheduledReportNow(id: string): Promise<SendNowOutcome> {
  return apiFetch<SendNowOutcome>(`/scheduled-reports/${id}/send-now`, { method: 'POST' });
}
