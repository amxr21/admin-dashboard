import { apiFetch } from '@/lib/api';

/**
 * Client for the bespoke notifications actions — see notifications.route.ts
 * for why "mark as read" (one, or all) needed its own routes rather than
 * living in the generic `/r/notifications` engine, which has no `update`
 * anymore. Reading the list itself (the count, the full list page, the
 * bell's preview) still goes through `fetchRows('notifications', ...)`, the
 * generic resource client — there is no reason to duplicate that here.
 */

export async function markAllNotificationsRead(): Promise<{ updated: number }> {
  return apiFetch<{ updated: number }>('/notifications/mark-all-read', { method: 'PATCH' });
}

export async function markNotificationRead(id: string): Promise<void> {
  await apiFetch(`/notifications/${id}/read`, { method: 'PATCH' });
}
