import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/render';
import { ApiError } from '@/lib/api';
import { CourierWorkloadSnapshotView } from '../courier-workload-snapshot-view';

const fetchCourierWorkloadSnapshot = vi.hoisted(() => vi.fn());

vi.mock('@/lib/reports-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reports-api')>();
  return { ...actual, fetchCourierWorkloadSnapshot };
});

beforeEach(() => {
  fetchCourierWorkloadSnapshot.mockReset();
});

describe('courier workload snapshot view (C3.5)', () => {
  it('shows live roster status and open assignments, no date range control', async () => {
    fetchCourierWorkloadSnapshot.mockResolvedValue({
      byStatus: [{ status: 'ACTIVE', count: 3 }],
      couriers: [{ driverId: 'd1', name: 'Sami Haddad', status: 'ACTIVE', openAssignments: 4 }],
    });

    render(<CourierWorkloadSnapshotView />);

    expect(await screen.findByText('Sami Haddad')).toBeInTheDocument();
    expect(fetchCourierWorkloadSnapshot).toHaveBeenCalledWith();
  });

  it('says the roster is empty rather than rendering headers over nothing', async () => {
    /**
     * With no couriers the page used to render an empty status strip above a
     * table with headers and no body — which reads as a broken report, not as
     * "nobody is on the roster yet". This was the only report view of ~30
     * with no empty branch at all.
     */
    fetchCourierWorkloadSnapshot.mockResolvedValue({ byStatus: [], couriers: [] });

    render(<CourierWorkloadSnapshotView />);

    expect(await screen.findByText(/no couriers on the roster/i)).toBeInTheDocument();
  });

  it('surfaces a load failure', async () => {
    fetchCourierWorkloadSnapshot.mockRejectedValue(new ApiError(500, 'SERVER_ERROR', 'boom'));

    render(<CourierWorkloadSnapshotView />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
