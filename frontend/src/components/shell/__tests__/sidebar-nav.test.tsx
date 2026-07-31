import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactNode } from 'react';

import { render, screen } from '@/test/render';
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
