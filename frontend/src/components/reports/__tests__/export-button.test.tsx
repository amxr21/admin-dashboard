import { describe, expect, it, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { ExportButton } from '../export-button';

/**
 * The shared export control (C3.4) — CSV/XLSX/PDF, all reading the same
 * backend columns. What's worth pinning: every format is offered, picking
 * one calls through with exactly that format (never silently falling back
 * to CSV), and a failure surfaces through the caller's `onError` rather than
 * being swallowed.
 */

const downloadReport = vi.hoisted(() => vi.fn());

vi.mock('@/lib/reports-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports-api')>();
  return { ...actual, downloadReport };
});

const RANGE = { from: '2026-01-01', to: '2026-01-31' };

beforeEach(() => {
  downloadReport.mockReset();
});

describe('format menu', () => {
  it('offers CSV, XLSX and PDF', async () => {
    render(<ExportButton view="overview" range={RANGE} onError={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /export/i }));

    expect(await screen.findByRole('menuitem', { name: 'CSV' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Excel (XLSX)' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'PDF' })).toBeInTheDocument();
  });
});

describe('picking a format', () => {
  it('downloads exactly the format picked, not a default', async () => {
    downloadReport.mockResolvedValue(undefined);

    render(<ExportButton view="overview" range={RANGE} onError={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /export/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'PDF' }));

    await waitFor(() => {
      expect(downloadReport).toHaveBeenCalledWith('overview', RANGE, 'pdf', undefined);
    });
  });

  it('threads extra params through (e.g. the explorer dimension)', async () => {
    downloadReport.mockResolvedValue(undefined);

    render(<ExportButton view="explorer" range={RANGE} extra={{ dimension: 'status' }} onError={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /export/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'CSV' }));

    await waitFor(() => {
      expect(downloadReport).toHaveBeenCalledWith('explorer', RANGE, 'csv', { dimension: 'status' });
    });
  });
});

describe('a failed export', () => {
  it('surfaces the error via onError rather than throwing or swallowing it', async () => {
    downloadReport.mockRejectedValue(new Error('network down'));
    const onError = vi.fn();

    render(<ExportButton view="overview" range={RANGE} onError={onError} />);

    await userEvent.click(screen.getByRole('button', { name: /export/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'CSV' }));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('network down');
    });
  });
});
