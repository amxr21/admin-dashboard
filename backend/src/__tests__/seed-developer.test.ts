import { PrismaClient, StaffRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { describe, expect, it, vi } from 'vitest';

import { seedDeveloperUser } from '../lib/seed-developer.js';

function store(role: StaffRole | null = null) {
  const findUnique = vi.fn().mockResolvedValue(role ? { role } : null);
  const create = vi.fn().mockResolvedValue({ id: 'created' });
  return {
    prisma: { user: { findUnique, create } } as unknown as PrismaClient,
    findUnique,
    create,
  };
}

describe('developer bootstrap', () => {
  it('creates a developer, never an owner, from explicit seed credentials', async () => {
    const db = store();
    const email = await seedDeveloperUser(db.prisma, {
      SEED_DEVELOPER_EMAIL: ' Developer@Example.com ',
      SEED_DEVELOPER_PASSWORD: 'a-unique-secret-with-enough-length',
    });

    expect(email).toBe('developer@example.com');
    const createArgs = db.create.mock.calls[0] as unknown as [{
      data: { role: StaffRole; email: string; passwordHash: string };
    }];
    const data = createArgs[0].data;
    expect(data.role).toBe(StaffRole.DEVELOPER);
    expect(data.email).toBe(email);
    expect(await bcrypt.compare('a-unique-secret-with-enough-length', data.passwordHash)).toBe(true);
  });

  it('leaves an existing developer password untouched on repeat runs', async () => {
    const db = store(StaffRole.DEVELOPER);
    await seedDeveloperUser(db.prisma, { SEED_DEVELOPER_EMAIL: 'developer@example.com' });
    expect(db.create).not.toHaveBeenCalled();
  });

  it('refuses to promote an existing owner at the same address', async () => {
    const db = store(StaffRole.OWNER);
    await expect(
      seedDeveloperUser(db.prisma, { SEED_DEVELOPER_EMAIL: 'owner@example.com' }),
    ).rejects.toThrow('already belongs to a OWNER account');
    expect(db.create).not.toHaveBeenCalled();
  });

  it('requires a strong password when the account does not exist', async () => {
    const db = store();
    await expect(
      seedDeveloperUser(db.prisma, {
        SEED_DEVELOPER_EMAIL: 'developer@example.com',
        SEED_DEVELOPER_PASSWORD: 'short',
      }),
    ).rejects.toThrow('at least 12 characters');
    expect(db.create).not.toHaveBeenCalled();
  });
});
