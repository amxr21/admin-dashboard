import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactNode } from 'react';

import { render, screen, waitFor } from '@/test/render';
import { SidebarNav } from '../sidebar-nav';

/**
 * The sidebar decides what a staff member is even aware exists. Getting it
 * wrong either hides work someone needs, or advertises pages that 403.
 *
 * Note: hiding a link is a COURTESY, not a control. These tests assert the UI
 * mirrors the permission model; the API enforces it independently.
 */

/**
 * The locale-aware Link and usePathname need a Next router, which doesn't
 * exist in jsdom. Substituting a plain anchor keeps the test focused on what
 * this component actually decides — which links to render and which is active.
 *
 * The factory is HOISTED above imports, so it must not reference anything from
 * module scope and must build elements with createElement rather than JSX.
 */
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/admin',
  Link: ({ href, children, ...props }: Record<string, unknown>) =>
    createElement('a', { href, ...props }, children as ReactNode),
}));

/**
 * Generic resources come from the API schema now, not from a hardcoded list.
 * This stands in for that fetch so the nav has both kinds of entry to merge:
 * hand-written pages (orders, staff) and schema-driven ones (customers,
 * products).
 *
 * The schema the API returns is ALREADY permission-filtered, but the nav
 * re-checks the role anyway — so this mock returns everything and lets the
 * component do the filtering the tests are actually about.
 */
vi.mock('@/components/providers/schema-provider', () => ({
  useResourceSchema: () => ({
    isLoading: false,
    failed: false,
    resources: [
      { resource: 'products', label: 'Products', group: 'catalogue', permissionArea: 'products' },
      { resource: 'categories', label: 'Categories', group: 'catalogue', permissionArea: 'categories' },
      { resource: 'discounts', label: 'Discounts', group: 'catalogue', permissionArea: 'discounts' },
      { resource: 'customers', label: 'Customers', group: 'people', permissionArea: 'customers' },
      { resource: 'reviews', label: 'Reviews', group: 'people', permissionArea: 'reviews' },
      { resource: 'notifications', label: 'Notifications', group: 'system', permissionArea: 'settings' },
    ],
  }),
}));

/**
 * The returns-awaiting-approval badge (C4.1) polls a real endpoint via
 * `useNavCounts` — mocked here the same way `notifications-bell.test.tsx`
 * mocks its own count fetch, so these pre-existing tests stay isolated from
 * network calls and from the badge's own async state entirely. The badge's
 * OWN behaviour is pinned separately below.
 */
const fetchReturns = vi.hoisted(() => vi.fn());
vi.mock('@/lib/returns-api', () => ({ fetchReturns }));

/** Only the override-rendering tests below need a non-empty `navLabels` —
 *  every other test in this file relies on the real provider's default
 *  (empty object), which is why this mock isn't applied at module scope. */
const navLabels = vi.hoisted(() => ({ current: {} as Record<string, string> }));
vi.mock('@/components/providers/settings-provider', () => ({
  useAppSettings: () => ({ navLabels: navLabels.current }),
}));

beforeEach(() => {
  fetchReturns.mockReset();
  fetchReturns.mockResolvedValue({ returns: [], total: 0, page: 1, pageSize: 1, totalPages: 0 });
  navLabels.current = {};
});

describe('permission-driven navigation', () => {
  it('shows every area to an owner', () => {
    render(<SidebarNav role="OWNER" />);

    expect(screen.getByRole('link', { name: /orders/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /staff/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /settings/i })).toBeInTheDocument();
  });

  it('hides staff management from a manager', () => {
    // Managers must not reach staff admin — otherwise a manager could grant
    // themselves OWNER.
    render(<SidebarNav role="MANAGER" />);

    expect(screen.getByRole('link', { name: /orders/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /staff/i })).not.toBeInTheDocument();
  });

  it('shows support only its own areas', () => {
    render(<SidebarNav role="SUPPORT" />);

    expect(screen.getByRole('link', { name: /orders/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /customers/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /discounts/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /reports/i })).not.toBeInTheDocument();
  });

  it('shows fulfillment its own areas', () => {
    render(<SidebarNav role="FULFILLMENT" />);

    expect(screen.getByRole('link', { name: /delivery/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /reports/i })).not.toBeInTheDocument();
  });

  it('shows a demo account almost everything, but not staff', () => {
    // A demo that hides most of the product is a poor demo — writes are
    // blocked server-side, not by hiding navigation. But `staff` is a real
    // exception: it lists real employees (names, emails, lockout state), and
    // the demo account is handed to prospective clients. This used to be
    // `ALL` here, which meant DEMO saw a "Staff" link that the API would
    // then 403 the moment it was clicked — the backend's own role config
    // (`ROLE_AREAS[DEMO]`) never granted `staff` to begin with. This test was
    // asserting the drift; it now asserts the real, matching behaviour.
    render(<SidebarNav role="DEMO" />);

    expect(screen.getByRole('link', { name: /reports/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /staff/i })).not.toBeInTheDocument();
  });

  it('hides a group heading when the role can reach none of its items', () => {
    // An "Administration" heading above nothing looks like a rendering bug.
    render(<SidebarNav role="SUPPORT" />);

    expect(screen.queryByText(/administration/i)).not.toBeInTheDocument();
  });
});

describe('active state', () => {
  it('marks the current page for assistive tech, not just colour', () => {
    render(<SidebarNav role="OWNER" />);

    expect(screen.getByRole('link', { name: /dashboard/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('does not mark sibling links as current', () => {
    render(<SidebarNav role="OWNER" />);

    expect(screen.getByRole('link', { name: /orders/i })).not.toHaveAttribute(
      'aria-current',
    );
  });
});

describe('interaction', () => {
  it('closes the mobile drawer when a link is tapped', async () => {
    // Without this the drawer stays open over the page the user just chose.
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<SidebarNav role="OWNER" onNavigate={onNavigate} />);

    await user.click(screen.getByRole('link', { name: /orders/i }));

    expect(onNavigate).toHaveBeenCalled();
  });
});

describe('collapsed rail', () => {
  it('exposes the label as a hover preview, since the visible text is sr-only', async () => {
    // A HoverCard, not a Tooltip — Radix's own guidance is that a Tooltip's
    // content must be plain text with no other way to reach it, but this
    // preview also carries a description and an "Open" cue, so it has no
    // implicit ARIA role. Queried via its `data-slot`, set in ui/hover-card.tsx.
    const user = userEvent.setup();
    render(<SidebarNav role="OWNER" collapsed />);

    await user.hover(screen.getByRole('link', { name: /orders/i }));

    // Portalled to `document.body`, not inside the render `container` —
    // Radix's HoverCard.Content (like Popover/Tooltip) renders through a
    // Portal, so it lives outside the tree `container` scopes to.
    const preview = await waitFor(() => {
      const found = document.body.querySelector('[data-slot="hover-card-content"]');
      if (!found) throw new Error('hover preview not open yet');
      return found;
    });
    expect(preview.textContent).toMatch(/orders/i);
  });

  it('opens the preview on keyboard focus alone, with no mouse hover', async () => {
    // Radix's HoverCard is deliberately hover-only by its own accessibility
    // guidance (a "sneak peek", never the sole path to content). A nav
    // destination has no OTHER preview mechanism and the collapsed rail's
    // icon has no visible label, so this is a CONTROLLED HoverCard that also
    // opens on the trigger's own focus/blur — this pins that keyboard focus
    // alone (no `hover()`, no pointer event at all) is enough.
    render(<SidebarNav role="OWNER" collapsed />);

    screen.getByRole('link', { name: /orders/i }).focus();

    const preview = await waitFor(() => {
      const found = document.body.querySelector('[data-slot="hover-card-content"]');
      if (!found) throw new Error('hover preview not open yet');
      return found;
    });
    expect(preview.textContent).toMatch(/orders/i);
  });

  it('still gives every link its full accessible name, preview or not', () => {
    // The sr-only span is what makes this true — the hover preview is a
    // SIGHTED-user convenience on top of it, never a replacement for it.
    render(<SidebarNav role="OWNER" collapsed />);

    expect(screen.getByRole('link', { name: /orders/i })).toBeInTheDocument();
  });

  it('opens the preview toward the reading-start side in Arabic', async () => {
    // `side` is a PHYSICAL Radix prop, not a logical one — this pins that the
    // component computes it from the real direction rather than hardcoding
    // 'right'.
    const user = userEvent.setup();
    render(<SidebarNav role="OWNER" collapsed />, { locale: 'ar' });

    await user.hover(screen.getByRole('link', { name: 'الطلبات' }));

    // Portalled to `document.body`, not inside the render `container` —
    // Radix's HoverCard.Content (like Popover/Tooltip) renders through a
    // Portal, so it lives outside the tree `container` scopes to.
    const preview = await waitFor(() => {
      const found = document.body.querySelector('[data-slot="hover-card-content"]');
      if (!found) throw new Error('hover preview not open yet');
      return found;
    });
    expect(preview.getAttribute('data-side')).toBe('left');
  });
});

describe('localisation', () => {
  it('renders Arabic labels', () => {
    render(<SidebarNav role="OWNER" />, { locale: 'ar' });

    expect(screen.getByRole('link', { name: 'الطلبات' })).toBeInTheDocument();
    expect(screen.getByText('التجارة')).toBeInTheDocument();
  });
});

describe('schema-driven entries', () => {
  it('renders resources from the schema alongside hand-written pages', () => {
    // The whole point of A5: adding a resource to admin.config.ts puts it in
    // the nav with no frontend change.
    render(<SidebarNav role="OWNER" />);

    // Hand-written (no schema entry exists for these).
    expect(screen.getByRole('link', { name: /orders/i })).toBeInTheDocument();
    // Schema-driven.
    expect(screen.getByRole('link', { name: /products/i })).toBeInTheDocument();
  });

  it('points schema entries at the generic page', () => {
    render(<SidebarNav role="OWNER" />);

    expect(screen.getByRole('link', { name: /products/i })).toHaveAttribute(
      'href',
      '/admin/r/products',
    );
  });

  it('still applies the role filter to schema entries', () => {
    // The API filters the schema too, but the nav must not RELY on that —
    // otherwise a change to either side silently widens what is advertised.
    render(<SidebarNav role="SUPPORT" />);

    expect(screen.getByRole('link', { name: /customers/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /discounts/i })).not.toBeInTheDocument();
  });
});

describe('nav count badge', () => {
  it('shows the returns-awaiting-approval count on the Returns link', async () => {
    fetchReturns.mockResolvedValueOnce({ returns: [], total: 4, page: 1, pageSize: 1, totalPages: 4 });
    render(<SidebarNav role="OWNER" />);

    const link = await screen.findByRole('link', { name: /returns.*4/i });
    expect(link).toBeInTheDocument();
  });

  it('renders no badge when nothing is awaiting approval', async () => {
    fetchReturns.mockResolvedValueOnce({ returns: [], total: 0, page: 1, pageSize: 1, totalPages: 0 });
    render(<SidebarNav role="OWNER" />);

    // Give the effect a tick to resolve before asserting the negative.
    await waitFor(() => expect(fetchReturns).toHaveBeenCalled());
    expect(screen.getByRole('link', { name: /^returns$/i })).toBeInTheDocument();
  });

  it('requests only the REQUESTED status, not every return', async () => {
    render(<SidebarNav role="OWNER" />);

    await waitFor(() => expect(fetchReturns).toHaveBeenCalled());
    expect(fetchReturns).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'REQUESTED' }),
    );
  });

  it('degrades to no badge, not a broken page, when the count fetch fails', async () => {
    fetchReturns.mockRejectedValueOnce(new Error('network error'));
    render(<SidebarNav role="OWNER" />);

    await waitFor(() => expect(fetchReturns).toHaveBeenCalled());
    expect(screen.getByRole('link', { name: /^returns$/i })).toBeInTheDocument();
  });
});

describe('groups from both sources are merged, not duplicated', () => {
  /**
   * NAVIGATION owns Delivery under `people`; the schema owns Customers and
   * Reviews under the same key. Concatenating the two lists rendered the
   * heading TWICE with the items split across them.
   *
   * React reported it as "two children with the same key" — but the warning
   * was the symptom. The bug was a sidebar showing "People" twice, which no
   * type or lint check can see and which reads as a layout glitch rather than
   * a data-merging mistake.
   */
  it('renders each group heading exactly once', () => {
    render(<SidebarNav role="OWNER" />);

    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent);

    expect(headings).toEqual([...new Set(headings)]);
  });

  it('puts hand-written and schema entries under the same heading', () => {
    const { container } = render(<SidebarNav role="OWNER" />);

    // Find the block whose heading is People, then check BOTH kinds of entry
    // live inside it rather than in two separate blocks.
    const block = [...container.querySelectorAll('div')].find((el) =>
      /people/i.test(el.querySelector('h2')?.textContent ?? ''),
    );

    expect(block).toBeTruthy();
    expect(block?.textContent).toMatch(/delivery/i); // hand-written
    expect(block?.textContent).toMatch(/customers/i); // schema-driven
  });

  it('keeps the unlabelled dashboard group separate', () => {
    // It has no heading to share, so it must never be folded into another.
    render(<SidebarNav role="OWNER" />);

    expect(screen.getByRole('link', { name: /dashboard/i })).toHaveAttribute(
      'href',
      '/admin',
    );
  });
});

describe('business-specific nav labels', () => {
  it('renders the built-in label when nothing is overridden', () => {
    render(<SidebarNav role="OWNER" />);

    expect(screen.getByRole('link', { name: /^staff$/i })).toBeInTheDocument();
  });

  it('renders the override in place of the built-in label', () => {
    navLabels.current = { staff: 'Baristas' };
    render(<SidebarNav role="OWNER" />);

    expect(screen.getByRole('link', { name: /baristas/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^staff$/i })).not.toBeInTheDocument();
  });
});
