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

  it('shows everything to a demo account', () => {
    // A demo that hides half the product is a poor demo. Writes are blocked
    // server-side, not by hiding navigation.
    render(<SidebarNav role="DEMO" />);

    expect(screen.getByRole('link', { name: /reports/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /staff/i })).toBeInTheDocument();
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
