import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/render';
import { ROLE_PERMISSIONS_CHANGED, RolePermissionsProvider, useCanAccessArea } from '../role-permissions-provider';

const fetchRolesModel = vi.hoisted(() => vi.fn());
vi.mock('@/lib/roles-api', () => ({ fetchRolesModel }));
vi.mock('@/i18n/navigation', () => ({ usePathname: () => '/admin/staff' }));

function PermissionReadout() {
  const canAccess = useCanAccessArea();
  return <p>{canAccess('CASHIER', 'reports') ? 'Reports allowed' : 'Reports denied'}</p>;
}

beforeEach(() => { fetchRolesModel.mockReset(); });

describe('live role permissions', () => {
  it('uses the saved server grant and refreshes after an owner edit', async () => {
    fetchRolesModel
      .mockResolvedValueOnce({ areas: ['reports'], roles: [{ role: 'CASHIER', areas: ['reports'], isLocked: false }] })
      .mockResolvedValueOnce({ areas: ['reports'], roles: [{ role: 'CASHIER', areas: [], isLocked: false }] });

    render(<RolePermissionsProvider><PermissionReadout /></RolePermissionsProvider>);
    expect(await screen.findByText('Reports allowed')).toBeInTheDocument();

    window.dispatchEvent(new Event(ROLE_PERMISSIONS_CHANGED));
    expect(await screen.findByText('Reports denied')).toBeInTheDocument();
  });
});
