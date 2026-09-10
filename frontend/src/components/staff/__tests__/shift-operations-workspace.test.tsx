import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ShiftOperationsWorkspace } from '@/components/staff/shift-operations-workspace';
import { render, screen } from '@/test/render';

const urlValues = vi.hoisted(() => ({ view: 'working' }));
vi.mock('@/hooks/useUrlState', () => ({
  useUrlState: () => ({ values: urlValues, setValues: vi.fn(), clear: vi.fn() }),
}));
vi.mock('@/components/staff/shifts-table', () => ({
  ShiftsTable: ({ openOnly }: { openOnly?: boolean }) => <p>{openOnly ? 'open shifts' : 'all shifts'}</p>,
}));
vi.mock('@/components/staff/shift-approval-queue', () => ({
  ShiftApprovalQueue: () => <p>approval queue</p>,
}));

beforeEach(() => { urlValues.view = 'working'; });

describe('shift operations workspace', () => {
  it('starts with the Working now view', () => {
    render(<ShiftOperationsWorkspace />);
    expect(screen.getByText('open shifts')).toBeInTheDocument();
    expect(screen.queryByText('approval queue')).not.toBeInTheDocument();
  });

  it('supports a shareable approvals view', () => {
    urlValues.view = 'approvals';
    render(<ShiftOperationsWorkspace />);
    expect(screen.getByText('approval queue')).toBeInTheDocument();
  });
});
