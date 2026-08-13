import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/test/render';
import { PermissionsMatrix } from '../permissions-matrix';
import type { RolesModel } from '@/lib/roles-api';

/**
 * B2.7 — the read-only half of the permissions matrix. (Custom roles, clone,
 * and a builder preview are parked — they need `StaffRole` to stop being a
 * fixed enum, a schema decision, not a UI task; see the component's own doc
 * comment.)
 *
 * What's worth pinning: this reads the LIVE `GET /roles` model rather than
 * the sidebar's advisory hardcoded copy (`config/areas.ts`), and a role
 * marked `readOnly` (DEMO) is visibly flagged as such — a matrix that shows
 * DEMO with the same checkmarks as OWNER would understate a real, documented
 * distinction (DEMO reaches every area but can write to none of them).
 */

const fetchRolesModel = vi.hoisted(() => vi.fn());

vi.mock('@/lib/roles-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/roles-api')>();
  return { ...actual, fetchRolesModel };
});

function makeModel(): RolesModel {
  return {
    areas: ['orders', 'staff'],
    roles: [
      { role: 'OWNER', label: 'Owner', areas: ['orders', 'staff'], readOnly: false },
      { role: 'SUPPORT', label: 'Support', areas: ['orders'], readOnly: false },
      { role: 'DEMO', label: 'Demo (read-only)', areas: ['orders', 'staff'], readOnly: true },
    ],
  };
}

beforeEach(() => {
  fetchRolesModel.mockReset();
  fetchRolesModel.mockResolvedValue(makeModel());
});

describe('PermissionsMatrix', () => {
  it('renders every area as a row and every role as a column', async () => {
    render(<PermissionsMatrix />);

    await waitFor(() => expect(fetchRolesModel).toHaveBeenCalled());
    expect(await screen.findByText('Orders')).toBeInTheDocument();
    expect(screen.getByText('Staff')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.getByText('Support')).toBeInTheDocument();
  });

  it('marks an area SUPPORT cannot reach as ungranted, not blank', async () => {
    render(<PermissionsMatrix />);

    // SUPPORT has no `staff` grant in the fixture — the cell must say so
    // explicitly (via its accessible label), not just omit a checkmark that
    // could as easily be a loading gap.
    expect(await screen.findByLabelText('Support cannot reach Staff')).toBeInTheDocument();
    expect(screen.getByLabelText('Owner can reach Staff')).toBeInTheDocument();
  });

  it('flags a read-only role distinctly — DEMO reaches every area but can write to none', async () => {
    render(<PermissionsMatrix />);

    // Same areas as OWNER in the fixture, but a real, documented difference
    // (DEMO cannot write anywhere) that a bare checkmark grid would hide.
    expect(await screen.findByText('Read-only')).toBeInTheDocument();
  });

  it('surfaces a failed load rather than an empty table', async () => {
    fetchRolesModel.mockRejectedValue(new Error('boom'));

    render(<PermissionsMatrix />);

    await waitFor(() => expect(fetchRolesModel).toHaveBeenCalled());
    // A failed load and "the model has zero areas" must not look the same —
    // an empty table would read as "no permissions exist" rather than "this
    // couldn't be checked."
    await waitFor(() => expect(screen.queryByRole('table')).not.toBeInTheDocument());
    expect(document.querySelector('.text-destructive')).toBeInTheDocument();
  });
});
