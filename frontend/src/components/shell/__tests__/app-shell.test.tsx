import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactNode } from 'react';

import { render, screen } from '@/test/render';
import { AppShell } from '../app-shell';

/**
 * "View as" is cosmetic ONLY — these tests exist to pin exactly that. It must
 * change the sidebar and the current page for a preview, and it must NEVER
 * be offered to anyone but the real high-privilege roles, regardless of what
 * a stale sessionStorage value says.
 */

let pathname = '/admin/staff';

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...props }: Record<string, unknown>) =>
    createElement('a', { href, ...props }, children as ReactNode),
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

// Irrelevant to what these tests check, and NotificationsBell fetches on
// mount — stubbed so the test isn't racing an unmocked request.
vi.mock('@/components/shell/notifications-bell', () => ({
  NotificationsBell: () => null,
}));

vi.mock('@/components/shell/diagnostics-bar', () => ({
  DiagnosticsBar: () => createElement('div', { 'data-testid': 'diagnostics-bar' }),
}));

const baseUser = { name: 'Owner Person', email: 'owner@example.test' } as const;

afterEach(() => {
  sessionStorage.clear();
  pathname = '/admin/staff';
});

describe('who gets offered the switcher', () => {
  it('offers it to an OWNER', () => {
    render(
      <AppShell user={{ ...baseUser, role: 'OWNER' }}>
        <p>page content</p>
      </AppShell>,
    );

    expect(screen.getByLabelText(/view as/i)).toBeInTheDocument();
  });

  it('offers it to a DEVELOPER', () => {
    render(
      <AppShell user={{ ...baseUser, role: 'DEVELOPER' }}>
        <p>page content</p>
      </AppShell>,
    );

    expect(screen.getByLabelText(/view as/i)).toBeInTheDocument();
  });

  it('does NOT offer it to a MANAGER', () => {
    render(
      <AppShell user={{ ...baseUser, role: 'MANAGER' }}>
        <p>page content</p>
      </AppShell>,
    );

    expect(screen.queryByLabelText(/view as/i)).not.toBeInTheDocument();
  });
});

describe('previewing narrows the sidebar', () => {
  it('hides staff and settings when previewing as SUPPORT', async () => {
    const user = userEvent.setup();
    pathname = '/admin';

    render(
      <AppShell user={{ ...baseUser, role: 'OWNER' }}>
        <p>page content</p>
      </AppShell>,
    );

    expect(screen.getByRole('link', { name: /staff/i })).toBeInTheDocument();

    await user.click(screen.getByLabelText(/view as/i));
    await user.click(screen.getByRole('option', { name: /support/i }));

    expect(screen.queryByRole('link', { name: /staff/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /orders/i })).toBeInTheDocument();
    expect(screen.getByText(/previewing as/i)).toBeInTheDocument();
  });

  it('exiting preview restores the real sidebar', async () => {
    const user = userEvent.setup();
    pathname = '/admin';

    render(
      <AppShell user={{ ...baseUser, role: 'OWNER' }}>
        <p>page content</p>
      </AppShell>,
    );

    await user.click(screen.getByLabelText(/view as/i));
    await user.click(screen.getByRole('option', { name: /support/i }));
    expect(screen.queryByRole('link', { name: /staff/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /exit preview/i }));

    expect(screen.getByRole('link', { name: /staff/i })).toBeInTheDocument();
    expect(screen.queryByText(/previewing as/i)).not.toBeInTheDocument();
  });
});

describe('the current page is gated too, not just the sidebar', () => {
  it('blocks a page the previewed role cannot reach, without hiding the real session', async () => {
    // /admin/staff maps to the `staff` area, which SUPPORT cannot reach.
    pathname = '/admin/staff';
    const user = userEvent.setup();

    render(
      <AppShell user={{ ...baseUser, role: 'OWNER' }}>
        <p>real staff page content</p>
      </AppShell>,
    );

    expect(screen.getByText('real staff page content')).toBeInTheDocument();

    await user.click(screen.getByLabelText(/view as/i));
    await user.click(screen.getByRole('option', { name: /support/i }));

    expect(screen.queryByText('real staff page content')).not.toBeInTheDocument();
    expect(screen.getByText(/not visible to this role/i)).toBeInTheDocument();
  });

  it('does not block a page the previewed role CAN reach', async () => {
    // /admin/r/customers maps to `customers`, which SUPPORT can reach.
    pathname = '/admin/r/customers';
    const user = userEvent.setup();

    render(
      <AppShell user={{ ...baseUser, role: 'OWNER' }}>
        <p>real customers page content</p>
      </AppShell>,
    );

    await user.click(screen.getByLabelText(/view as/i));
    await user.click(screen.getByRole('option', { name: /support/i }));

    expect(screen.getByText('real customers page content')).toBeInTheDocument();
  });
});

describe('a stale preview never survives to a different, lower-privileged user', () => {
  it('ignores a leftover sessionStorage value when the real role cannot preview', () => {
    sessionStorage.setItem('admin-dashboard:view-as-role', 'DEMO');

    render(
      <AppShell user={{ ...baseUser, role: 'SUPPORT' }}>
        <p>page content</p>
      </AppShell>,
    );

    // SUPPORT's own real sidebar, not DEMO's — the stale value is inert.
    expect(screen.getByRole('link', { name: /orders/i })).toBeInTheDocument();
    expect(screen.queryByText(/previewing as/i)).not.toBeInTheDocument();
  });
});
