import { describe, expect, it } from 'vitest';

import {
  EMAIL_MAX_LENGTH,
  isAccountEmailValid,
  normalizeAccountEmail,
} from '@/lib/identity-validation';

describe('account email form validation', () => {
  it('normalizes the same identity before submission', () => {
    expect(normalizeAccountEmail('  Person@Example.COM ')).toBe('person@example.com');
  });

  it.each(['person@example.com', 'first.last+shop@example.co.uk'])(
    'accepts a usable address: %s',
    (email) => expect(isAccountEmailValid(email)).toBe(true),
  );

  it.each(['', 'person', 'person@', '@example.com', `a@${'b'.repeat(EMAIL_MAX_LENGTH)}.com`])(
    'rejects invalid input: %s',
    (email) => expect(isAccountEmailValid(email)).toBe(false),
  );
});
