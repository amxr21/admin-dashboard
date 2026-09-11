import { z } from 'zod';

export const EMAIL_MAX_LENGTH = 255;

/**
 * One account-email contract for every authentication and staff boundary.
 * Lower-casing is identity normalization, not display formatting: allowing
 * create/login/reset flows to disagree on it makes the same address behave
 * like different accounts depending on which screen submitted it.
 */
export const accountEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(EMAIL_MAX_LENGTH, 'Email address is too long');
