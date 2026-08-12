import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { ApiError } from '@/lib/api';
import { ScheduledReportSheet } from '../scheduled-report-sheet';
import type { ScheduledReport } from '@/lib/scheduled-reports-api';

/**
 * The create/edit sheet in isolation — prefill on edit, the recipients
 * parser (comma/newline separated, trimmed), and that a 400 from the API
 * (e.g. a malformed recipient the client-side parser let through) surfaces
 * the server's real message rather than a generic one.
 */

vi.mock('@/components/providers/settings-provider', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/components/providers/settings-provider')>();
  return {
    ...actual,
    useAppSettings: () => ({ editPanelMode: 'drawer' as const }),
  };
});

const createScheduledReport = vi.hoisted(() => vi.fn());
const updateScheduledReport = vi.hoisted(() => vi.fn());

vi.mock('@/lib/scheduled-reports-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/scheduled-reports-api')>();
  return {
    ...actual,
    createScheduledReport,
    updateScheduledReport,
  };
});

function makeSchedule(overrides: Partial<ScheduledReport> = {}): ScheduledReport {
  return {
    id: 's1',
    reportKey: 'staff-activity',
    frequency: 'WEEKLY',
    format: 'CSV',
    recipients: ['a@example.test', 'b@example.test'],
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
  createScheduledReport.mockReset();
  updateScheduledReport.mockReset();
});

describe('creating a schedule', () => {
  it('parses comma- and newline-separated recipients, trimmed', async () => {
    createScheduledReport.mockResolvedValue(makeSchedule());
    const onSaved = vi.fn();

    render(
      <ScheduledReportSheet schedule={null} open onOpenChange={vi.fn()} onSaved={onSaved} />,
    );

    await userEvent.type(
      screen.getByLabelText(/recipients/i),
      ' a@example.test, b@example.test \nc@example.test ',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createScheduledReport).toHaveBeenCalledWith({
        reportKey: 'overview',
        frequency: 'DAILY',
        format: 'CSV',
        recipients: ['a@example.test', 'b@example.test', 'c@example.test'],
      });
    });
  });

  it('surfaces the server-side 400 message verbatim rather than a generic error', async () => {
    createScheduledReport.mockRejectedValue(new ApiError(400, 'VALIDATION', 'Recipient "x" is not a valid email.'));

    render(<ScheduledReportSheet schedule={null} open onOpenChange={vi.fn()} onSaved={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/recipients/i), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Recipient "x" is not a valid email.')).toBeInTheDocument();
  });

  it('submits the selected non-CSV format (C3.4 — XLSX/PDF are real formats, not a CSV fallback)', async () => {
    createScheduledReport.mockResolvedValue(makeSchedule({ format: 'XLSX' }));

    render(<ScheduledReportSheet schedule={null} open onOpenChange={vi.fn()} onSaved={vi.fn()} />);

    await userEvent.click(screen.getByLabelText(/^format$/i));
    await userEvent.click(await screen.findByRole('option', { name: 'XLSX' }));
    await userEvent.type(screen.getByLabelText(/recipients/i), 'owner@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(createScheduledReport).toHaveBeenCalledWith(
        expect.objectContaining({ format: 'XLSX' }),
      );
    });
  });
});

describe('editing a schedule', () => {
  it('prefills every field from the schedule being edited', async () => {
    render(
      <ScheduledReportSheet schedule={makeSchedule()} open onOpenChange={vi.fn()} onSaved={vi.fn()} />,
    );

    expect((await screen.findAllByText('Edit scheduled report')).length).toBeGreaterThan(0);
    expect(screen.getByText('Staff activity')).toBeInTheDocument();
    expect(screen.getByText('Weekly')).toBeInTheDocument();
    expect(screen.getByDisplayValue('a@example.test, b@example.test')).toBeInTheDocument();
  });

  it('submits an update, not a create', async () => {
    updateScheduledReport.mockResolvedValue(makeSchedule());
    const onOpenChange = vi.fn();

    render(
      <ScheduledReportSheet
        schedule={makeSchedule()}
        open
        onOpenChange={onOpenChange}
        onSaved={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(updateScheduledReport).toHaveBeenCalledWith('s1', {
      reportKey: 'staff-activity',
      frequency: 'WEEKLY',
      format: 'CSV',
      recipients: ['a@example.test', 'b@example.test'],
    });
    expect(createScheduledReport).not.toHaveBeenCalled();
  });
});
