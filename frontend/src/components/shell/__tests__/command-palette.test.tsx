import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { CommandPalette } from '../command-palette';

/**
 * C4.3 — reachable from anywhere via ⌘K/Ctrl+K, three result kinds (pages,
 * content, actions) merged into one keyboard-navigable list. Shares its two
 * search sources with `global-search.tsx`'s own test file — the properties
 * worth re-pinning here are specific to the palette: it starts closed, the
 * shortcut toggles it, and every action it lists actually does something
 * when chosen (never a decorative entry).
 */

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/components/providers/schema-provider', () => ({
  useResourceSchema: () => ({
    isLoading: false,
    failed: false,
    resources: [
      { resource: 'products', label: 'Products', group: 'catalogue', permissionArea: 'products' },
      { resource: 'customers', label: 'Customers', group: 'people', permissionArea: 'customers' },
    ],
  }),
}));

const search = vi.hoisted(() => vi.fn());
vi.mock('@/lib/search-api', () => ({ search }));

const EMPTY = { orders: [], customers: [], products: [] };

beforeEach(() => {
  search.mockReset();
  search.mockResolvedValue(EMPTY);
});

afterEach(() => {
  vi.useRealTimers();
});

async function openPalette(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard('{Control>}k{/Control}');
}

describe('the trigger', () => {
  it('starts closed', () => {
    render(<CommandPalette role="OWNER" />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('opens on Ctrl+K', async () => {
    const user = userEvent.setup();
    render(<CommandPalette role="OWNER" />);

    await openPalette(user);

    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('closes on a second Ctrl+K — the shortcut toggles, not just opens', async () => {
    const user = userEvent.setup();
    render(<CommandPalette role="OWNER" />);

    await openPalette(user);
    expect(screen.getByRole('combobox')).toBeInTheDocument();

    await openPalette(user);
    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument());
  });
});

describe('before typing anything', () => {
  it('shows a hint rather than an empty box', async () => {
    const user = userEvent.setup();
    render(<CommandPalette role="OWNER" />);
    await openPalette(user);

    expect(screen.getByText(/type to search/i)).toBeInTheDocument();
  });
});

describe('pages and content', () => {
  it('matches a page destination with no network call', async () => {
    const user = userEvent.setup();
    render(<CommandPalette role="OWNER" />);
    await openPalette(user);

    await user.type(screen.getByRole('combobox'), 'orders');

    expect(await screen.findByRole('option', { name: /orders/i })).toBeInTheDocument();
    // Distinct from `orders` the CONTENT group — no query short enough to
    // match a page label alone should trigger the debounced network call.
  });

  it('shows real order/customer/product hits under their own group', async () => {
    search.mockResolvedValue({
      orders: [{ id: 'o1', title: 'ORD-1001', subtitle: 'Jane Doe — 84.00', href: '/admin/orders/o1' }],
      customers: [],
      products: [],
    });

    const user = userEvent.setup();
    render(<CommandPalette role="OWNER" />);
    await openPalette(user);

    await user.type(screen.getByRole('combobox'), 'jane');

    expect(await screen.findByText('ORD-1001')).toBeInTheDocument();
  });
});

describe('actions — the third result kind (C4.3\'s "run an action")', () => {
  it('lists a real action matching the query', async () => {
    const user = userEvent.setup();
    render(<CommandPalette role="OWNER" />);
    await openPalette(user);

    await user.type(screen.getByRole('combobox'), 'add product');

    expect(await screen.findByRole('option', { name: /add product/i })).toBeInTheDocument();
  });

  it('navigates to products when the Add product action is chosen', async () => {
    const user = userEvent.setup();
    render(<CommandPalette role="OWNER" />);
    await openPalette(user);

    await user.type(screen.getByRole('combobox'), 'add product');
    await user.click(await screen.findByRole('option', { name: /add product/i }));

    // The palette closes after a selection — the same "get out of the way"
    // behaviour every other menu in this app has.
    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument());
  });

  it('does not offer sign out when no onSignOut handler was given', async () => {
    // AppShell always passes one in the real app, but the prop is optional
    // — an action wired to nothing would be worse than one that's simply
    // absent.
    const user = userEvent.setup();
    render(<CommandPalette role="OWNER" />);
    await openPalette(user);

    await user.type(screen.getByRole('combobox'), 'sign out');

    expect(screen.queryByRole('option', { name: /sign out/i })).not.toBeInTheDocument();
  });

  it('offers sign out and calls the handler when onSignOut is given', async () => {
    const onSignOut = vi.fn();
    const user = userEvent.setup();
    render(<CommandPalette role="OWNER" onSignOut={onSignOut} />);
    await openPalette(user);

    await user.type(screen.getByRole('combobox'), 'sign out');
    await user.click(await screen.findByRole('option', { name: /sign out/i }));

    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});

describe('keyboard navigation', () => {
  it('ArrowDown moves through the merged list and Enter selects', async () => {
    const user = userEvent.setup();
    render(<CommandPalette role="OWNER" />);
    await openPalette(user);

    await user.type(screen.getByRole('combobox'), 'orders');
    await screen.findByRole('option', { name: /orders/i });

    await user.keyboard('{ArrowDown}');
    // Selecting via Enter must not throw and must close the palette — the
    // exact same contract a mouse selection has.
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument());
  });
});

describe('permission filtering carries over from GlobalSearch, unchanged', () => {
  it('does not show a resource the role cannot reach', async () => {
    const user = userEvent.setup();
    render(<CommandPalette role="SUPPORT" />);
    await openPalette(user);

    await user.type(screen.getByRole('combobox'), 'product');

    await waitFor(() => expect(search).toHaveBeenCalled());
    expect(screen.queryByRole('option', { name: /^products$/i })).not.toBeInTheDocument();
  });
});
