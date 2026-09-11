import { describe, expect, it } from 'vitest';

import { accountEmailSchema, EMAIL_MAX_LENGTH } from '../lib/identity-validation.js';

describe('account email validation', () => {
  it('normalizes surrounding whitespace and case', () => {
    expect(accountEmailSchema.parse('  Person@Example.COM ')).toBe('person@example.com');
  });

  it.each(['missing-at.example.com', '@example.com', 'person@'])('rejects malformed email %s', (email) => {
    expect(accountEmailSchema.safeParse(email).success).toBe(false);
  });

  it('enforces the shared storage limit', () => {
    const oversized = `${'a'.repeat(EMAIL_MAX_LENGTH)}@example.com`;
    expect(accountEmailSchema.safeParse(oversized).success).toBe(false);
  });
});
