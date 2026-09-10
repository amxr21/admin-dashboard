import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/render';
import { FeatureSettingsLinks } from '../feature-settings-links';

let role = 'OWNER';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', name: 'Person', email: 'person@example.test', role } }),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: Record<string, unknown>) =>
    createElement('a', { href, ...props }, children as ReactNode),
}));

beforeEach(() => { role = 'OWNER'; });

describe('FeatureSettingsLinks', () => {
  it('makes all owner-managed feature settings discoverable', () => {
    render(<FeatureSettingsLinks />);

    expect(screen.getByRole('link', { name: /businesses and branches/i })).toHaveAttribute('href', '/admin/branches');
    expect(screen.getByRole('link', { name: /organization structure/i })).toHaveAttribute('href', '/admin/settings/organization');
    expect(screen.getByRole('link', { name: /role permissions/i })).toHaveAttribute('href', '/admin/staff#staff-permissions-title');
    expect(screen.getByRole('link', { name: /scheduled reports/i })).toHaveAttribute('href', '/admin/reports/scheduled');
  });

  it('does not expose owner-only structure controls to support staff', () => {
    role = 'SUPPORT';
    render(<FeatureSettingsLinks />);

    expect(screen.queryByRole('link', { name: /organization structure/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /role permissions/i })).not.toBeInTheDocument();
  });
});
