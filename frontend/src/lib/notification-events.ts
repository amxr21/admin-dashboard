const NOTIFICATIONS_CHANGED_EVENT = 'admin-dashboard:notifications-changed';

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
export function getSafeNotificationLink(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value === '/admin' || value.startsWith('/admin/') ? value : null;
}
