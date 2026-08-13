import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, waitFor } from '@/test/render';
import { GlobalSearch } from '../global-search';

/**
 * Two result sources in one box (C4.2): destination pages (client-side,
 * instant) and real content — orders/customers/products — from a debounced
 * `GET /search` call. The load-bearing property is that a query too short
 * to search never fires that request, and a real query fires it only ONCE
 * per pause in typing, not once per keystroke.
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

describe('destination pages — instant, client-side', () => {
  it('matches a page destination with no network call', async () => {
    const user = userEvent.setup();
    render(<GlobalSearch role="OWNER" />);

    await user.type(screen.getByRole('combobox'), 'orders');

    expect(await screen.findByRole('option', { name: /orders/i })).toBeInTheDocument();
  });
});

describe('content search is debounced, not fired per keystroke', () => {
  it('does not call search() for a query below the minimum length', async () => {
    const user = userEvent.setup();
    render(<GlobalSearch role="OWNER" />);

    await user.type(screen.getByRole('combobox'), 'z');
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(search).not.toHaveBeenCalled();
  });

  it('fires once after typing pauses, not once per character', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<GlobalSearch role="OWNER" />);

    await user.type(screen.getByRole('combobox'), 'zephyr');
    await vi.advanceTimersByTimeAsync(300);

    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('zephyr');
  });
});

describe('grouped, keyboard-navigable results', () => {
  it('renders each non-empty category under its own heading', async () => {
    search.mockResolvedValue({
      orders: [{ id: 'o1', title: 'ORD-1001', subtitle: 'Jane Doe — 84.00', href: '/admin/orders/o1' }],
      customers: [{ id: 'c1', title: 'Jane Doe', subtitle: 'jane@example.test', href: '/admin/r/customers?search=jane%40example.test' }],
      products: [],
    });

    const user = userEvent.setup();
    render(<GlobalSearch role="OWNER" />);
    await user.type(screen.getByRole('combobox'), 'jane');

    expect(await screen.findByText('ORD-1001')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    // The empty PRODUCTS group renders no heading at all — an empty section
    // reads as a rendering bug, same discipline the sidebar nav applies.
    expect(screen.queryByText(/^products$/i)).not.toBeInTheDocument();
  });

  it('ArrowDown moves through pages AND content as one flat list', async () => {
    search.mockResolvedValue({
      orders: [{ id: 'o1', title: 'ORD-1001', subtitle: null, href: '/admin/orders/o1' }],
      customers: [],
      products: [],
    });

    const user = userEvent.setup();
    render(<GlobalSearch role="OWNER" />);
    const input = screen.getByRole('combobox');
    await user.type(input, 'orders');

    await waitFor(() => expect(screen.getByRole('option', { name: /ORD-1001/i })).toBeInTheDocument());

    // First option (a page match) is active by default; arrowing down must
    // reach the order hit that was appended after it.
    await user.keyboard('{ArrowDown}');
    const orderOption = screen.getByRole('option', { name: /ORD-1001/i });
    expect(orderOption).toHaveAttribute('aria-selected', 'true');
  });
});

describe('a failed content search degrades to page results only', () => {
  it('does not break the box when the request rejects', async () => {
    search.mockRejectedValue(new Error('network error'));

    const user = userEvent.setup();
    render(<GlobalSearch role="OWNER" />);
    await user.type(screen.getByRole('combobox'), 'orders');

    expect(await screen.findByRole('option', { name: /orders/i })).toBeInTheDocument();
  });
});

describe('permission filtering carries over to pages, unchanged from before', () => {
  it('does not show a resource the role cannot reach', async () => {
    const user = userEvent.setup();
    // SUPPORT cannot reach `products` — same fixture area used across the
    // app's other permission tests.
    render(<GlobalSearch role="SUPPORT" />);

    await user.type(screen.getByRole('combobox'), 'product');

    await waitFor(() => expect(search).toHaveBeenCalled());
    expect(screen.queryByRole('option', { name: /^products$/i })).not.toBeInTheDocument();
  });
});

describe('"/" focuses search from anywhere (C4.6)', () => {
  it('focuses the box when nothing else has focus', async () => {
    const user = userEvent.setup();
    render(<GlobalSearch role="OWNER" />);

    document.body.focus();
    await user.keyboard('/');

    expect(screen.getByRole('combobox')).toHaveFocus();
  });

  it('does not hijack "/" while an unrelated text field has focus', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <input aria-label="Slug" />
        <GlobalSearch role="OWNER" />
      </div>,
    );

    const slugField = screen.getByLabelText('Slug');
    slugField.focus();
    await user.keyboard('/');

    // The character reached the field it was typed into, and the search
    // box was never stolen focus from it.
    expect(slugField).toHaveValue('/');
    expect(screen.getByRole('combobox')).not.toHaveFocus();
  });
});
