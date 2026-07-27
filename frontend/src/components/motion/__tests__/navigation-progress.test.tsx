import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/test/render';
import {
  NavigationPending,
  NavigationProgressProvider,
} from '../navigation-progress';

/**
 * The overlay that covers the wait BEFORE a page arrives.
 *
 * `useLinkStatus` and `usePathname` are stubbed because the real ones need the
 * App Router's navigation internals, which jsdom has none of. What's under
 * test is this file's own logic — the counting and the reset — not Next's
 * reporting, which is not ours to verify.
 */

const linkStatus = vi.hoisted(() => ({ pending: false }));
const pathname = vi.hoisted(() => ({ value: '/admin' }));

vi.mock('next/link', () => ({
  useLinkStatus: () => linkStatus,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => pathname.value,
}));

beforeEach(() => {
  linkStatus.pending = false;
  pathname.value = '/admin';
});

function renderWith(count: number) {
  return render(
    <NavigationProgressProvider>
      {Array.from({ length: count }, (_, index) => (
        <NavigationPending key={index} />
      ))}
      <p>page content</p>
    </NavigationProgressProvider>,
  );
}

describe('when nothing is navigating', () => {
  it('shows no overlay', () => {
    renderWith(1);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('page content')).toBeInTheDocument();
  });
});

describe('while a navigation is pending', () => {
  it('shows the overlay', async () => {
    linkStatus.pending = true;
    renderWith(1);

    // The overlay waits ~120ms before appearing, so a fast navigation never
    // flashes a loader. findBy* covers that delay.
    expect(await screen.findByRole('status')).toBeInTheDocument();
  });

  it('keeps it up while a second link is still pending', async () => {
    // A counter, not a boolean: a fast second click leaves two links pending,
    // and the first settling must not clear the overlay.
    linkStatus.pending = true;
    const { rerender } = renderWith(2);

    expect(await screen.findByRole('status')).toBeInTheDocument();

    // One unmounts (its cleanup decrements); the other is still going.
    rerender(
      <NavigationProgressProvider>
        <NavigationPending />
        <p>page content</p>
      </NavigationProgressProvider>,
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

describe('when the new page arrives', () => {
  it('clears the overlay even if a pending link never settled', async () => {
    /**
     * The failure this prevents: the sidebar unmounts links when a group's
     * visibility changes, so a link can disappear mid-navigation. Without a
     * reset on arrival the count would stay above zero and the overlay would
     * stay up over a perfectly loaded page.
     */
    linkStatus.pending = true;
    const { rerender } = renderWith(1);

    expect(await screen.findByRole('status')).toBeInTheDocument();

    pathname.value = '/admin/orders';
    rerender(
      <NavigationProgressProvider>
        <NavigationPending />
        <p>page content</p>
      </NavigationProgressProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });
});

describe('NavigationPending itself', () => {
  it('renders nothing', () => {
    const { container } = render(<NavigationPending />);

    expect(container.innerHTML).toBe('');
  });
});
