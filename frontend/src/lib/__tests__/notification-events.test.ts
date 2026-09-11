import { describe, expect, it, vi } from 'vitest';

import {
  announceNotificationsChanged,
  getSafeNotificationLink,
  subscribeToNotificationChanges,
} from '../notification-events';

describe('notification state coordination', () => {
  it('notifies every mounted notification surface after a mutation', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToNotificationChanges(listener);

    announceNotificationsChanged();
    expect(listener).toHaveBeenCalledOnce();

    unsubscribe();
    announceNotificationsChanged();
    expect(listener).toHaveBeenCalledOnce();
  });

  it('accepts only authenticated internal admin destinations', () => {
    expect(getSafeNotificationLink('/admin/returns', 'CASHIER')).toBe('/admin/returns');
    expect(getSafeNotificationLink('/admin/inventory', 'CASHIER')).toBeNull();
    expect(getSafeNotificationLink('https://example.test/phishing', 'OWNER')).toBeNull();
    expect(getSafeNotificationLink('//example.test/phishing', 'OWNER')).toBeNull();
    expect(getSafeNotificationLink('/login', 'OWNER')).toBeNull();
  });
});
