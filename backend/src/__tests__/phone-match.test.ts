import { describe, expect, it } from 'vitest';
import { normalizePhone, phonesMatch } from '../lib/phone.js';
describe('complete phone comparison', () => {
  it.each([
    ['050 123 4567', '+971 50 123 4567', true],
    ['00971501234567', '0501234567', true],
    ['501234567', '+971501234567', true],
    ['971501234567', '+971501234567', true],
    ['+971501234567', '00971501234567', true],
    ['+971501234567', '+972501234567', false],
    ['+971501234567', '+9711234567', false],
    ['+971501234567', '1234567', false],
    ['0501234567', '1234567', false],
    ['0501234567', '0501234568', false],
    ['04 123 4567', '04 123 4567', true],
    ['04 123 4567', '+971 4 123 4567', true],
    ['+965 5123 4567', '5123 4567', true],
    ['+971501234567', '51234567', false],
    ['', '', false],
  ])('%s compared with %s', (a, b, expected) => {
    expect(phonesMatch(a, b)).toBe(expected);
    expect(phonesMatch(b, a)).toBe(expected);
  });
  it('retains the digits-only normalized lookup contract used by other services', () => {
    expect(normalizePhone('+971 50 123 4567')).toBe('971501234567');
    expect(normalizePhone('050 123 4567')).toBe('0501234567');
  });
});
