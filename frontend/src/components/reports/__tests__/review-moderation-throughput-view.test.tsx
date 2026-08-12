import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/render';
import { ApiError } from '@/lib/api';
import { ReviewModerationThroughputView } from '../review-moderation-throughput-view';

const urlState = vi.hoisted(() => {
  let current = new URLSearchParams();
  return {
    get: () => current,
    reset: () => {
      current = new URLSearchParams();
    },
    write: (href: string) => {
      current = new URLSearchParams(href.split('?')[1] ?? '');
    },
  };
});

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: Record<string, unknown>) =>
    createElement('a', { href, ...props }, children as ReactNode),
  useRouter: () => ({ push: (href: string) => urlState.write(href), replace: (href: string) => urlState.write(href) }),
  usePathname: () => '/admin/reports/review-moderation-throughput',
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => urlState.get(),
}));

const fetchReviewModerationThroughput = vi.hoisted(() => vi.fn());
const downloadReport = vi.hoisted(() => vi.fn());

vi.mock('@/lib/reports-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports-api')>();
  return { ...actual, fetchReviewModerationThroughput, downloadReport };
});

beforeEach(() => {
  urlState.reset();
  fetchReviewModerationThroughput.mockReset();
  downloadReport.mockReset();
});

describe('review moderation throughput view (C3.5)', () => {
  it('shows submitted/approved/rejected/pending counts', async () => {
    fetchReviewModerationThroughput.mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-01-31' },
      submitted: 10,
      approved: 7,
      rejected: 1,
      pending: 2,
      averageHoursToModeration: 12.5,
    });

    render(<ReviewModerationThroughputView />);

    expect(await screen.findByText('Submitted')).toBeInTheDocument();
    expect(screen.getByText('12.5')).toBeInTheDocument();
  });

  it('renders an em dash when the average is null (no moderated reviews yet)', async () => {
    fetchReviewModerationThroughput.mockResolvedValue({
      range: { from: '2026-01-01', to: '2026-01-31' },
      submitted: 2,
      approved: 0,
      rejected: 0,
      pending: 2,
      averageHoursToModeration: null,
    });

    render(<ReviewModerationThroughputView />);

    expect(await screen.findByText('—')).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    fetchReviewModerationThroughput.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<ReviewModerationThroughputView />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
