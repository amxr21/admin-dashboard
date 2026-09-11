import { canAccessArea, type StaffRole } from '@/config/areas';

export type RelatedRecordDestination = 'order' | 'return' | 'staffActivity';

/** Permission-aware cross-module destinations kept out of individual cells. */
export function getRelatedRecordHref(
  role: StaffRole,
  destination: RelatedRecordDestination,
  id: string,
): string | null {
  const encodedId = encodeURIComponent(id);

  switch (destination) {
    case 'order':
      return canAccessArea(role, 'orders') ? `/admin/orders/${encodedId}` : null;
    case 'return':
      return canAccessArea(role, 'returns') ? `/admin/returns?detail=${encodedId}` : null;
    case 'staffActivity':
      return canAccessArea(role, 'staff') ? `/admin/audit?actorId=${encodedId}` : null;
  }
}
