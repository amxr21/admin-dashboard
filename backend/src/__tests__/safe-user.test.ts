import { describe, expect, it } from 'vitest';
import { SAFE_USER_SELECT, toSafeUser, type SafeUser } from '../services/safe-user.js';

describe('public user identity allowlist', () => {
  it('discards secrets, recovery relations and future columns from full rows', () => {
    const now = new Date();
    const publicUser: SafeUser = {
      id: 'u1', email: 'u@example.test', name: 'User', phone: null,
      role: 'OWNER', isActive: true, accessExpiresAt: null,
      lastLoginAt: null, onboardedAt: null, createdAt: now,
      updatedAt: now, twoFactorEnabled: true,
    };
    const fullRow = {
      ...publicUser, passwordHash: 'hash', failedLoginAttempts: 9,
      lockedUntil: now, twoFactorSecret: 'encrypted-secret', tokenVersion: 3,
      twoFactorBackupCodes: [{ codeHash: 'recovery-hash' }],
      passwordResetTokens: [{ tokenHash: 'reset-hash' }], futureSecret: 'new-column',
    };
    expect(toSafeUser(fullRow)).toEqual(publicUser);
    expect(Object.keys(toSafeUser(fullRow)).sort()).toEqual(Object.keys(SAFE_USER_SELECT).sort());
    expect(JSON.stringify(toSafeUser(fullRow))).not.toMatch(/hash|encrypted-secret|new-column/);
  });
});
