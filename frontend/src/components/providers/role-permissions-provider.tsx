'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { canAccessArea as defaultCanAccessArea, type Area, type StaffRole } from '@/config/areas';
import { usePathname } from '@/i18n/navigation';
import { fetchRolesModel, type RolesModel } from '@/lib/roles-api';

export const ROLE_PERMISSIONS_CHANGED = 'role-permissions-changed';

const RolePermissionsContext = createContext<RolesModel | null>(null);

export function RolePermissionsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [model, setModel] = useState<RolesModel | null>(null);

  const refresh = useCallback(async () => {
    try {
      setModel(await fetchRolesModel());
    } catch {
      // The API still enforces permissions. Keep the last successful model if
      // a transient refresh fails; on first load the shipped defaults render.
    }
  }, []);

  useEffect(() => { void refresh(); }, [pathname, refresh]);
  useEffect(() => {
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    window.addEventListener(ROLE_PERMISSIONS_CHANGED, onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(ROLE_PERMISSIONS_CHANGED, onFocus);
    };
  }, [refresh]);

  return <RolePermissionsContext.Provider value={model}>{children}</RolePermissionsContext.Provider>;
}

export function useCanAccessArea() {
  const model = useContext(RolePermissionsContext);
  return useCallback((role: StaffRole, area: Area): boolean => {
    const grant = model?.roles.find((entry) => entry.role === role);
    return grant ? grant.areas.includes(area) : defaultCanAccessArea(role, area);
  }, [model]);
}
