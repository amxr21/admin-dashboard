import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/test/render';
import { BranchSwitcher } from '../branch-switcher';
import type { BranchSummary } from '@/lib/branches-api';

/**
 * The topbar branch switcher, and the overlay it paints while switching.
 *
 * This file exists because the overlay had NO coverage at all: the spinner
 * could have been deleted outright and every suite would still have passed.
 *
 * The overlay is the one piece of feedback during a deliberate full-document
 * reload (see the component's own note on why scoping cannot be a local state
 * update), so an empty flash is the failure mode worth catching. jsdom
 * computes no layout, so these assert STRUCTURE — the visual result still
 * needs a real browser.
 */

const fetchBranches = vi.fn();
const writeBranchId = vi.fn();
const readBranchId = vi.fn();

vi.mock('@/lib/branches-api', () => ({
  fetchBranches: () => fetchBranches() as unknown,
}));

vi.mock('@/lib/auth-storage', () => ({
  writeBranchId: (...args: unknown[]) => writeBranchId(...args),
  readBranchId: () => readBranchId() as unknown,
}));

function branch(overrides: Partial<BranchSummary> = {}): BranchSummary {
  return {
    id: 'b1',
    name: 'Marina',
    code: 'MAR',
    city: null,
    isSellingPoint: true,
    isDefault: false,
    businessId: 'biz1',
    businessName: 'Coffee Co',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  readBranchId.mockReturnValue(null);
  fetchBranches.mockResolvedValue([branch(), branch({ id: 'b2', name: 'Downtown' })]);
});

describe('BranchSwitcher', () => {
  it('does not render for a single-branch install', async () => {
    // A control that can only ever have one answer is noise in the topbar.
    fetchBranches.mockResolvedValue([branch()]);

    const { container } = render(<BranchSwitcher />);

    await waitFor(() => expect(fetchBranches).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the switcher once there is more than one branch', async () => {
    render(<BranchSwitcher />);

    expect(await screen.findByRole('combobox')).toBeInTheDocument();
  });

  it('shows no overlay until a branch is actually chosen', async () => {
    render(<BranchSwitcher />);

    await screen.findByRole('combobox');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('paints an EXPLAINED overlay before reloading, never an empty flash', async () => {
    // The reload is deliberate and blunt (see the component's note). The
    // overlay is the only feedback during it, so it must carry a real
    // announcement — a bare spinner, or nothing, leaves the screen looking
    // broken for the length of a document load.
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });

    render(<BranchSwitcher />);
    const trigger = await screen.findByRole('combobox');

    // Radix Select opens on keyboard too; selecting via the listbox is what a
    // real switch does.
    trigger.focus();
    const user = (await import('@testing-library/user-event')).default;
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: /Downtown/ }));

    const overlay = await screen.findByRole('status');
    // Not an empty box: the text is the whole reason this overlay exists.
    expect(overlay.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    expect(overlay.querySelector('svg')).not.toBeNull();

    // Chosen branch is persisted before the reload, or the new document would
    // come back on the old branch.
    expect(writeBranchId).toHaveBeenCalledWith('b2');
  });

  it('survives a failed branch load without breaking the shell', async () => {
    // Deliberately not an error state: the switcher simply does not appear and
    // everything keeps working unscoped, which is what a no-branch install
    // does anyway.
    fetchBranches.mockRejectedValue(new Error('offline'));

    const { container } = render(<BranchSwitcher />);

    await waitFor(() => expect(fetchBranches).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
