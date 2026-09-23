'use client';

import { createContext, useContext, type ReactNode } from 'react';

import type { StaffRole } from '@/config/areas';

const EffectiveRoleContext = createContext<StaffRole | null>(null);

export function EffectiveRoleProvider({
  role,
  children,
}: {
  role: StaffRole;
  children: ReactNode;
}) {
  return <EffectiveRoleContext.Provider value={role}>{children}</EffectiveRoleContext.Provider>;
}

/**
 * The role whose UI is currently being presented. During ordinary use this
 * is the signed-in role; during View As it is the narrower preview role.
 * It is presentation-only and must never be sent as proof of authorization.
 */
export function useEffectiveRole(): StaffRole | null {
  return useContext(EffectiveRoleContext);
}
