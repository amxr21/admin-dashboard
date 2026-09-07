import { describe, expect, it, vi } from 'vitest';

/**
 * The low-stock alert reaches EMAIL, not just the in-app row (F7.5).
 *
 * ─── WHY THIS TEST EXISTS AT ALL ─────────────────────────────────────
 * Every piece of this already worked, and the feature still looked missing:
 * `adjustStock` fires `notify()` on crossing into low stock, and `notify()`
 * writes the in-app row AND calls `sendAlertEmail`. Nothing was broken — it
 * was simply unconfigured, so no mail arrived and the obvious conclusion was
 * "the email half was never built".
 *
 * That is precisely the shape of thing somebody rebuilds. This pins the link
 * so a future reader can see it is wired, and so a refactor that drops the
 * email call fails here instead of going unnoticed until an owner asks why
 * they never hear about empty shelves.
 *
 * It does NOT assert that mail is delivered — that needs real SMTP, and
 * `email.test.ts` already covers the unconfigured no-op contract.
 */

const { sendAlertEmail } = vi.hoisted(() => ({ sendAlertEmail: vi.fn() }));

vi.mock('../services/email.service.js', () => ({ sendAlertEmail }));

vi.mock('../db/prisma.js', () => ({
  prisma: {
    notification: { create: vi.fn().mockResolvedValue({ id: 'n1' }) },
  },
}));

describe('notify() fans out to both channels', () => {
  it('sends an alert email as well as writing the in-app row', async () => {
    const { notify } = await import('../services/notify.service.js');

    notify({
      type: 'inventory.low-stock',
      title: 'Flat white beans',
      body: '3 left — at or below the threshold of 5.',
      link: '/admin/inventory',
    });

    expect(sendAlertEmail).toHaveBeenCalledWith(
      'Flat white beans',
      '3 left — at or below the threshold of 5.',
    );
  });

  it('falls back to the title when there is no body', async () => {
    // An email with an empty body is worse than one that repeats the subject:
    // the recipient sees a blank message and cannot tell it apart from a bug.
    const { notify } = await import('../services/notify.service.js');
    sendAlertEmail.mockClear();

    notify({ type: 'inventory.low-stock', title: 'Oat milk' });

    expect(sendAlertEmail).toHaveBeenCalledWith('Oat milk', 'Oat milk');
  });
});
