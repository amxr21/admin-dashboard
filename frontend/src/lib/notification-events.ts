import { canAccessArea, type Area, type StaffRole } from '@/config/areas';

const NOTIFICATIONS_CHANGED_EVENT = 'admin-dashboard:notifications-changed';

const DESTINATION_AREAS: readonly [prefix: string, area: Area][] = [
  ['/admin/customer-cases', 'customers'],
  ['/admin/inventory', 'inventory'],
  ['/admin/delivery', 'delivery'],
  ['/admin/returns', 'returns'],
  ['/admin/orders', 'orders'],
  ['/admin/staff', 'staff'],
  ['/admin/audit', 'staff'],
  ['/admin/r/products', 'products'],
  ['/admin/r/customers', 'customers'],
];

export function announceNotificationsChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
  }
}

export function subscribeToNotificationChanges(listener: () => void) {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, listener);
  return () => window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, listener);
}

/** Notifications may only navigate inside the authenticated admin surface. */
export function getSafeNotificationLink(value: unknown, role: StaffRole): string | null {
  if (typeof value !== 'string') return null;
  if (value === '/admin') return value;
  if (!value.startsWith('/admin/')) return null;

  const match = DESTINATION_AREAS.find(([prefix]) =>
    value === prefix || value.startsWith(`${prefix}/`) || value.startsWith(`${prefix}?`),
  );
  return match && canAccessArea(role, match[1]) ? value : null;
}
