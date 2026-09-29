import type { Prisma } from '@prisma/client';

/** Public identity fields only. New model columns never join API responses by default. */
export const SAFE_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  phone: true,
  role: true,
  isActive: true,
  accessExpiresAt: true,
  lastLoginAt: true,
  onboardedAt: true,
  createdAt: true,
  updatedAt: true,
  twoFactorEnabled: true,
} as const satisfies Prisma.UserSelect;

export type SafeUser = Prisma.UserGetPayload<{ select: typeof SAFE_USER_SELECT }>;

/** Reconstruct explicitly even when a caller has loaded a full database row. */
export function toSafeUser(user: SafeUser): SafeUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    role: user.role,
    isActive: user.isActive,
    accessExpiresAt: user.accessExpiresAt,
    lastLoginAt: user.lastLoginAt,
    onboardedAt: user.onboardedAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    twoFactorEnabled: user.twoFactorEnabled,
  };
}
