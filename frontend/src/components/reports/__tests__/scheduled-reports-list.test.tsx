import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { ApiError } from '@/lib/api';
import { Toaster } from '@/components/ui/sonner';
import { ScheduledReportsList } from '../scheduled-reports-list';
import type { ScheduledReport } from '@/lib/scheduled-reports-api';

/**
 * Scheduled reports (C3.2) — a recurring send of one report to a recipient
 * list. What's worth pinning: the create/edit form (a Sheet, per C4.7 — a
 * brief detour from this list, not a destination) round-trips through the
 * real API client, the delete confirmation is a real AlertDialog step (not
 * a single click), and "send now" surfaces the SAME honest outcome the real
 * cron tick would get (e.g. "not sent — email_not_configured" in dev),
 * never a fake "sent!" regardless of what actually happened.
 */

vi.mock('@/components/providers/settings-provider', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/components/providers/settings-provider')>();
  return {
    ...actual,
    useAppSettings: () => ({ editPanelMode: 'drawer' as const }),
  };
});

const fetchScheduledReports = vi.hoisted(() => vi.fn());
const createScheduledReport = vi.hoisted(() => vi.fn());
const updateScheduledReport = vi.hoisted(() => vi.fn());
const deleteScheduledReport = vi.hoisted(() => vi.fn());
const sendScheduledReportNow = vi.hoisted(() => vi.fn());

vi.mock('@/lib/scheduled-reports-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/scheduled-reports-api')>();
  return {
    ...actual,
    fetchScheduledReports,
    createScheduledReport,
    updateScheduledReport,
    deleteScheduledReport,
    sendScheduledReportNow,
  };
});

function makeSchedule(overrides: Partial<ScheduledReport> = {}): ScheduledReport {
  return {
    id: 's1',
    reportKey: 'overview',
    frequency: 'DAILY',
    format: 'CSV',
    recipients: ['manager@example.test'],
    isActive: true,
    lastRunAt: null,
    lastRunStatus: null,
    createdById: 'u1',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  fetchScheduledReports.mockReset();
  createScheduledReport.mockReset();
  updateScheduledReport.mockReset();
  deleteScheduledReport.mockReset();
  sendScheduledReportNow.mockReset();
});

describe('listing schedules', () => {
  it('shows an empty state with none saved', async () => {
    fetchScheduledReports.mockResolvedValue([]);

    render(<ScheduledReportsList />);

    expect(await screen.findByText(/no scheduled reports yet/i)).toBeInTheDocument();
  });

  it('lists a schedule with its report, frequency and recipients', async () => {
    fetchScheduledReports.mockResolvedValue([makeSchedule()]);

    render(<ScheduledReportsList />);

    expect(await screen.findByText('Revenue overview')).toBeInTheDocument();
    expect(screen.getByText('Daily')).toBeInTheDocument();
    expect(screen.getByText('manager@example.test')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('shows "Never run" rather than a blank cell when lastRunAt is null', async () => {
    fetchScheduledReports.mockResolvedValue([makeSchedule({ lastRunAt: null })]);

    render(<ScheduledReportsList />);

    expect(await screen.findByText(/never run/i)).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    fetchScheduledReports.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<ScheduledReportsList />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('creating a schedule', () => {
  it('opens the sheet, submits, and reloads the list', async () => {
    fetchScheduledReports.mockResolvedValue([]);
    createScheduledReport.mockResolvedValue(makeSchedule({ id: 's2' }));

    render(
      <>
        <ScheduledReportsList />
        <Toaster />
      </>,
    );

    await screen.findByText(/no scheduled reports yet/i);
    await userEvent.click(screen.getByRole('button', { name: /add schedule/i }));

    const recipientsField = await screen.findByLabelText(/recipients/i);
    await userEvent.type(recipientsField, 'owner@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createScheduledReport).toHaveBeenCalledWith({
        reportKey: 'overview',
        frequency: 'DAILY',
        format: 'CSV',
        recipients: ['owner@example.test'],
      });
    });
  });

  it('rejects an empty recipient list before calling the API', async () => {
    fetchScheduledReports.mockResolvedValue([]);

    render(<ScheduledReportsList />);

    await screen.findByText(/no scheduled reports yet/i);
    await userEvent.click(screen.getByRole('button', { name: /add schedule/i }));

    await userEvent.click(await screen.findByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(createScheduledReport).not.toHaveBeenCalled();
  });
});

describe('deleting a schedule', () => {
  it('requires a real confirmation step, not a single click', async () => {
    fetchScheduledReports.mockResolvedValue([makeSchedule()]);

    render(<ScheduledReportsList />);

    await screen.findByText('Revenue overview');
    // Edit + toggle are the two visible row actions; delete (3rd, per
    // row-actions.tsx's max-2-visible rule) is behind the overflow menu.
    await userEvent.click(screen.getByRole('button', { name: /more actions/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /delete the revenue overview schedule/i }));

    expect(await screen.findByText(/delete this schedule/i)).toBeInTheDocument();
    expect(deleteScheduledReport).not.toHaveBeenCalled();
  });

  it('deletes after confirming', async () => {
    fetchScheduledReports.mockResolvedValueOnce([makeSchedule()]).mockResolvedValueOnce([]);
    deleteScheduledReport.mockResolvedValue(undefined);

    render(
      <>
        <ScheduledReportsList />
        <Toaster />
      </>,
    );

    await screen.findByText('Revenue overview');
    await userEvent.click(screen.getByRole('button', { name: /more actions/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /delete the revenue overview schedule/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(deleteScheduledReport).toHaveBeenCalledWith('s1');
    });
  });
});

describe('sending a schedule now', () => {
  it('reports the real outcome — sent', async () => {
    fetchScheduledReports.mockResolvedValue([makeSchedule()]);
    sendScheduledReportNow.mockResolvedValue({ sent: true });

    render(
      <>
        <ScheduledReportsList />
        <Toaster />
      </>,
    );

    await screen.findByText('Revenue overview');
    await userEvent.click(screen.getByRole('button', { name: /send revenue overview now/i }));

    expect(await screen.findByText('Sent.')).toBeInTheDocument();
  });

  it('reports the real outcome — not sent, with the honest reason (never a fake success)', async () => {
    fetchScheduledReports.mockResolvedValue([makeSchedule()]);
    sendScheduledReportNow.mockResolvedValue({ sent: false, reason: 'email_not_configured' });

    render(
      <>
        <ScheduledReportsList />
        <Toaster />
      </>,
    );

    await screen.findByText('Revenue overview');
    await userEvent.click(screen.getByRole('button', { name: /send revenue overview now/i }));

    expect(await screen.findByText(/not sent — email_not_configured/i)).toBeInTheDocument();
  });
});

describe('toggling active state', () => {
  it('deactivates an active schedule', async () => {
    fetchScheduledReports
      .mockResolvedValueOnce([makeSchedule({ isActive: true })])
      .mockResolvedValueOnce([makeSchedule({ isActive: false })]);
    updateScheduledReport.mockResolvedValue(makeSchedule({ isActive: false }));

    render(<ScheduledReportsList />);

    await screen.findByText('Active');
    await userEvent.click(screen.getByRole('button', { name: /deactivate the revenue overview schedule/i }));

    await waitFor(() => {
      expect(updateScheduledReport).toHaveBeenCalledWith('s1', { isActive: false });
    });
  });
});
