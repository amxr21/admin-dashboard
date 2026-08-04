import { describe, expect, it } from 'vitest';

import { sendAlertEmail } from '../services/email.service.js';

/**
 * This dev/test environment has no SMTP_* env vars set, so the one thing
 * that matters here is the same thing `upload.test.ts` checks for
 * Cloudinary: an unconfigured integration must resolve quietly, never
 * throw — a low-stock or return-request notification (see notify.service.ts)
 * must not fail just because nobody set up outgoing email.
 */
describe('sendAlertEmail', () => {
  it('resolves without throwing when SMTP is not configured', async () => {
    await expect(sendAlertEmail('Test subject', 'Test body')).resolves.toBeUndefined();
  });
});
