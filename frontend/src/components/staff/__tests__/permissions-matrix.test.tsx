import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

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

const { fetchRolesModel, setRoleAreas, resetRoleAreas, currentRole } = vi.hoisted(() => ({
  fetchRolesModel: vi.fn(),
  setRoleAreas: vi.fn(),
  resetRoleAreas: vi.fn(),
  // Mutable so a test can become a non-owner without re-mocking the module.
  currentRole: { value: 'OWNER' as string },
}));

vi.mock('@/lib/roles-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/roles-api')>();
  return { ...actual, fetchRolesModel, setRoleAreas, resetRoleAreas };
});

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1', role: currentRole.value } }),
}));

function makeModel(): RolesModel {
  return {
    areas: ['orders', 'staff'],
    roles: [
      // OWNER is LOCKED — always full access, never editable (O8).
      {
        role: 'OWNER',
        label: 'Owner',
        areas: ['orders', 'staff'],
        readOnly: false,
        isLocked: true,
        isCustomised: false,
      },
      {
        role: 'SUPPORT',
        label: 'Support',
        areas: ['orders'],
        readOnly: false,
        isLocked: false,
        isCustomised: false,
      },
      {
        role: 'DEMO',
        label: 'Demo (read-only)',
        areas: ['orders', 'staff'],
        readOnly: true,
        isLocked: false,
        isCustomised: false,
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // A FRESH model each time. `makeModel()` builds new objects, but the mock
  // must be re-armed per test or a suite that edits the grid leaves the next
  // test reading its result.
  fetchRolesModel.mockReset();
  fetchRolesModel.mockImplementation(() => Promise.resolve(makeModel()));
  currentRole.value = 'OWNER';
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
    // Viewed by somebody who CANNOT edit, the grid is still a report and each
    // cell says so explicitly via its label — not just an omitted checkmark
    // that could as easily be a loading gap.
    currentRole.value = 'MANAGER';

    render(<PermissionsMatrix />);

    expect(await screen.findByLabelText('Support cannot reach Staff')).toBeInTheDocument();
    expect(screen.getByLabelText('Owner can reach Staff')).toBeInTheDocument();

    currentRole.value = 'OWNER';
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

describe('editing permissions (O8.4)', () => {
  /**
   * ─── WHAT THESE PROTECT ──────────────────────────────────────────────
   * 1. OWNER/DEVELOPER rows are never editable. An owner who unticked their
   *    own `settings` box would lose the screen that ticks it back.
   * 2. Only an owner sees the controls at all. A MANAGER who forged the
   *    request would still be refused by the API, but showing checkboxes that
   *    always fail is worse than showing none.
   * 3. A failed save ROLLS BACK. A grid left showing a permission the server
   *    rejected is worse than one that never moved.
   */
  it('sends the whole intended set, not a diff', async () => {
    // The grid is checkboxes over a set the server owns. A diff computed
    // against a stale page removes an area nobody touched.
    setRoleAreas.mockResolvedValue({});

    render(<PermissionsMatrix />);

    await userEvent.click(await screen.findByLabelText('Support can open Staff'));

    await waitFor(() => {
      expect(setRoleAreas).toHaveBeenCalledWith('SUPPORT', ['orders', 'staff']);
    });
  });

  it('removes an area by sending the set without it', async () => {
    setRoleAreas.mockResolvedValue({});

    render(<PermissionsMatrix />);

    await userEvent.click(await screen.findByLabelText('Support can open Orders'));

    await waitFor(() => {
      expect(setRoleAreas).toHaveBeenCalledWith('SUPPORT', []);
    });
  });

  it('never offers a checkbox for a LOCKED role', async () => {
    // OWNER always keeps full access. Its cells stay icons.
    render(<PermissionsMatrix />);

    await screen.findByText('Owner');

    expect(screen.queryByLabelText('Owner can open Staff')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Owner can reach Staff')).toBeInTheDocument();
  });

  it('shows no controls at all to a non-owner', async () => {
    currentRole.value = 'MANAGER';

    render(<PermissionsMatrix />);

    await screen.findByText('Support');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();

    currentRole.value = 'OWNER';
  });

  it('rolls back when the save fails', async () => {
    // The grid must never show a permission the server did not accept.
    const { ApiError } = await import('@/lib/api');
    setRoleAreas.mockRejectedValue(new ApiError(400, 'BAD_REQUEST', 'nope'));

    render(<PermissionsMatrix />);

    const box = await screen.findByLabelText('Support can open Staff');
    await userEvent.click(box);

    await waitFor(() => {
      expect(screen.getByLabelText('Support can open Staff')).not.toBeChecked();
    });
  });
});
