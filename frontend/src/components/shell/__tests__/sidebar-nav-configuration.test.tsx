import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/render';
import { SidebarNav } from '../sidebar-nav';
import type { StaffRole } from '@/config/areas';

/**
 * Who sees the Configuration link in the sidebar.
 *
 * The link mirrors `requireRole(OWNER, DEVELOPER)` on
 * `GET /diagnostics/configuration`. The pairing is the point: MANAGER holds
 * the `settings` AREA and would pass an area check, which is exactly why that
 * endpoint is role-gated instead. A future refactor reaching for
 * `canAccessArea(role, 'settings')` here — the obvious-looking simplification,
 * since Settings sits in the same trailing block — would expose it, and these
 * tests are what catch that.
 *
 * Hiding the link is presentation only; the API refuses regardless. That is
 * why this file asserts visibility, not authorization.
 */

vi.mock('@/components/providers/schema-provider', () => ({
  useResourceSchema: () => ({ resources: [] }),
}));

vi.mock('@/components/providers/settings-provider', () => ({
  useAppSettings: () => ({ navLabels: {} }),
}));

vi.mock('@/hooks/useNavCounts', () => ({
  useNavCounts: () => ({}),
}));

function renderFor(role: StaffRole) {
  return render(<SidebarNav role={role} />);
}

const CONFIGURATION = /configuration|الإعدادات التقنية/i;

describe('the Configuration nav link', () => {
  it.each(['DEVELOPER', 'OWNER'] as const)('is shown to %s', (role) => {
    renderFor(role);

    expect(screen.getByRole('link', { name: CONFIGURATION })).toBeInTheDocument();
  });

  it('is hidden from MANAGER, who holds `settings` but not this', () => {
    renderFor('MANAGER');

    // The Settings link still renders — proving the two are gated separately
    // and that this assertion is not just "the whole block is missing".
    expect(screen.getByRole('link', { name: /settings|الإعدادات/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: CONFIGURATION })).toBeNull();
  });

  it.each(['CASHIER', 'SUPPORT', 'FULFILLMENT', 'DEMO'] as const)(
    'is hidden from %s',
    (role) => {
      renderFor(role);

      expect(screen.queryByRole('link', { name: CONFIGURATION })).toBeNull();
    },
  );
});
