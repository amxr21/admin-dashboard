import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ShiftOperationsWorkspace } from '@/components/staff/shift-operations-workspace';
import { render, screen } from '@/test/render';

const { urlValues, setValues } = vi.hoisted(() => ({
  urlValues: { view: 'working', page: '1' },
  setValues: vi.fn(),
}));
vi.mock('@/hooks/useUrlState', () => ({
  useUrlState: () => ({ values: urlValues, setValues, clear: vi.fn() }),
}));
vi.mock('@/components/staff/shifts-table', () => ({
  ShiftsTable: ({ openOnly, page }: { openOnly?: boolean; page?: number }) => (
    <p>{openOnly ? `open shifts page ${page}` : 'all shifts'}</p>
  ),
}));
vi.mock('@/components/staff/shift-approval-queue', () => ({
  ShiftApprovalQueue: ({ page }: { page?: number }) => <p>approval queue page {page}</p>,
}));

beforeEach(() => {
  urlValues.view = 'working';
  urlValues.page = '1';
  setValues.mockReset();
});

describe('shift operations workspace', () => {
  it('starts with the Working now view', () => {
    render(<ShiftOperationsWorkspace />);
    expect(screen.getByText('open shifts page 1')).toBeInTheDocument();
    expect(screen.queryByText(/approval queue/)).not.toBeInTheDocument();
  });

  it('supports a shareable approvals view', () => {
    urlValues.view = 'approvals';
    render(<ShiftOperationsWorkspace />);
    expect(screen.getByText('approval queue page 1')).toBeInTheDocument();
  });

  it('restores pagination from the URL for either view', () => {
    urlValues.page = '3';
    render(<ShiftOperationsWorkspace />);
    expect(screen.getByText('open shifts page 3')).toBeInTheDocument();
  });
});
