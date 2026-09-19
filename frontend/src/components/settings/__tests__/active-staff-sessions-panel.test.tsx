import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/render';
import { ActiveStaffSessionsPanel } from '../active-staff-sessions-panel';

const fetchActiveStaffSessions = vi.hoisted(() => vi.fn());
const currentRole = vi.hoisted(() => ({ value: 'OWNER' }));
vi.mock('@/lib/staff-api', () => ({ fetchActiveStaffSessions }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { role: currentRole.value } }) }));

beforeEach(() => {
  currentRole.value = 'OWNER';
  fetchActiveStaffSessions.mockReset();
  fetchActiveStaffSessions.mockResolvedValue([{
    id: 'session-1', userId: 'cashier-1', name: 'Cashier One', email: 'cashier@example.test',
    role: 'CASHIER', userAgent: 'Till browser', ip: '127.0.0.1',
    createdAt: '2026-09-14T10:00:00.000Z', lastSeenAt: '2026-09-14T10:01:00.000Z',
  }]);
});

describe('owner staff sessions', () => {
  it('shows a new cashier session in the owner overview', async () => {
    render(<ActiveStaffSessionsPanel />);
    expect(await screen.findByText(/Cashier One · Cashier/)).toBeInTheDocument();
    expect(screen.getByText(/Till browser/)).toBeInTheDocument();
  });

  it('does not request or show the owner view to another role', () => {
    currentRole.value = 'MANAGER';
    render(<ActiveStaffSessionsPanel />);
    expect(screen.queryByText(/staff signed in now/i)).not.toBeInTheDocument();
    expect(fetchActiveStaffSessions).not.toHaveBeenCalled();
  });
});
