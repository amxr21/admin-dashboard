import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { Toaster } from '@/components/ui/sonner';
import { BranchesView } from '../branches-view';
import type { BusinessSummary } from '@/lib/branches-api';

/**
 * The org chart, and the controls F8 never shipped (O7 stage 3).
 *
 * ─── WHAT THESE TESTS ARE ACTUALLY FOR ───────────────────────────────
 * The list itself is not the risk — it renders what the API returns. The risk
 * is the two places this screen tells the user something about STATE:
 *
 * 1. A created branch must reach the branch switcher. The switcher loads once
 *    on mount, so without a deliberate refresh a new branch is invisible in
 *    it while sitting right there in this list — and a switcher that omits a
 *    branch is one an owner cannot scope to.
 * 2. A warehouse and a shop must be told apart on sight. They differ by one
 *    boolean, and the whole point of `isSellingPoint` is that a warehouse
 *    holds stock and takes no orders.
 */

const { fetchBusinesses, createBranch } = vi.hoisted(() => ({
  fetchBusinesses: vi.fn(),
  createBranch: vi.fn(),
}));

vi.mock('@/lib/branches-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/branches-api')>()),
  fetchBusinesses,
  createBranch,
}));

/** The roster panel fetches on open; nothing here exercises it. */
vi.mock('@/lib/staff-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/staff-api')>()),
  fetchStaff: vi.fn().mockResolvedValue({ staff: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
}));

const BUSINESS: BusinessSummary = {
  id: 'biz-1',
  name: 'Corner Cafe',
  kind: null,
  legalName: null,
  taxId: null,
  email: null,
  phone: null,
  addressLine: null,
  city: 'Dubai',
  country: null,
  currency: null,
  timezone: null,
  logoUrl: null,
  isActive: true,
  branches: [
    {
      id: 'branch-1',
      name: 'Marina',
      code: 'MAR',
      city: 'Dubai',
      isSellingPoint: true,
      isActive: true,
      isDefault: true,
      staffCount: 3,
    },
    {
      id: 'branch-2',
      name: 'Central Store',
      code: 'WH1',
      city: 'Dubai',
      isSellingPoint: false,
      isActive: true,
      isDefault: false,
      staffCount: 0,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchBusinesses.mockResolvedValue([BUSINESS]);
});

describe('the org chart', () => {
  it('groups branches under the business that owns them', async () => {
    render(<BranchesView />);

    expect(await screen.findByText('Corner Cafe')).toBeInTheDocument();
    expect(screen.getByText('Marina')).toBeInTheDocument();
    expect(screen.getByText('Central Store')).toBeInTheDocument();
  });

  it('tells a warehouse apart from a shop', async () => {
    // One boolean is the entire difference, and it decides whether a place
    // can take an order at all. It has to be readable without opening a form.
    render(<BranchesView />);

    await screen.findByText('Marina');

    expect(screen.getByText(/Dubai · Shop/)).toBeInTheDocument();
    expect(screen.getByText(/Dubai · Warehouse/)).toBeInTheDocument();
  });

  it('marks which branch is the default', async () => {
    render(<BranchesView />);

    expect(await screen.findByText('Default')).toBeInTheDocument();
  });

  it('explains what a business IS when there are none', async () => {
    // A bare "+" tells a first-time owner nothing about what they are adding.
    fetchBusinesses.mockResolvedValue([]);

    render(<BranchesView />);

    expect(await screen.findByText('No businesses yet')).toBeInTheDocument();
    expect(screen.getByText(/what print on an invoice/i)).toBeInTheDocument();
  });

  it('says a business with no branches cannot trade yet', async () => {
    fetchBusinesses.mockResolvedValue([{ ...BUSINESS, branches: [] }]);

    render(<BranchesView />);

    expect(
      await screen.findByText(/Add one before recording stock or taking orders/i),
    ).toBeInTheDocument();
  });
});

describe('creating a branch reaches the switcher', () => {
  it('refreshes so a new branch appears in the topbar switcher', async () => {
    // The switcher loads once on mount. Without this the new branch sits in
    // the list below while being absent from the control used to scope to it.
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });

    createBranch.mockResolvedValue({ id: 'branch-3', name: 'Downtown' });

    const user = userEvent.setup();
    render(
      <>
        <BranchesView />
        <Toaster />
      </>,
    );

    await user.click(await screen.findByRole('button', { name: /add branch/i }));

    await user.type(await screen.findByLabelText(/branch name/i), 'Downtown');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(createBranch).toHaveBeenCalledWith(
        expect.objectContaining({ businessId: 'biz-1', name: 'Downtown' }),
      );
    });

    await waitFor(() => {
      expect(reload).toHaveBeenCalled();
    });
  });

  it("surfaces the API's own message when a code is already taken", async () => {
    // The server's 409 names the field. Flattening it to "something went
    // wrong" would leave the owner guessing which of six inputs to change.
    const { ApiError } = await import('@/lib/api');
    createBranch.mockRejectedValue(
      new ApiError(409, 'CONFLICT', 'A branch with this code already exists in this business'),
    );

    const user = userEvent.setup();
    render(<BranchesView />);

    await user.click(await screen.findByRole('button', { name: /add branch/i }));
    await user.type(await screen.findByLabelText(/branch name/i), 'Marina Two');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(
      await screen.findByText(/A branch with this code already exists/i),
    ).toBeInTheDocument();
  });

  it('refuses to submit a branch with no name', async () => {
    const user = userEvent.setup();
    render(<BranchesView />);

    await user.click(await screen.findByRole('button', { name: /add branch/i }));
    await screen.findByLabelText(/branch name/i);
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText('A branch needs a name')).toBeInTheDocument();
    expect(createBranch).not.toHaveBeenCalled();
  });
});
