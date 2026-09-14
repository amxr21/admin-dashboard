import { PrismaClient, StaffRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { seedDemoAccount } from '../../prisma/seed-demo-account.js';

function prismaFor(existing: { role: StaffRole } | null = null) {
  const findUnique = vi.fn().mockResolvedValue(existing);
  const create = vi.fn().mockResolvedValue({ id: 'demo-id' });
  return {
    prisma: { user: { findUnique, create } } as unknown as PrismaClient,
    create,
  };
}

describe('seedDemoAccount', () => {
  const variables = {
    SEED_DEMO_EMAIL: 'demo+__demo__@example.invalid',
    SEED_DEMO_PASSWORD: 'Demo-only-password-2026',
    SEED_DEMO_NAME: 'Demo',
  } as NodeJS.ProcessEnv;

  it('creates an explicit read-only Demo account', async () => {
    const prisma = prismaFor();

    await expect(seedDemoAccount(prisma.prisma, variables)).resolves.toBe('demo+__demo__@example.invalid');
    const createArgs = prisma.create.mock.calls[0] as unknown as [{
      data: { email: string; name: string; role: StaffRole };
    }];
    expect(createArgs[0].data).toMatchObject({
      email: 'demo+__demo__@example.invalid',
      name: 'Demo',
      role: StaffRole.DEMO,
    });
  });

  it('is idempotent and never changes an existing account role', async () => {
    const existingDemo = prismaFor({ role: StaffRole.DEMO });
    await expect(seedDemoAccount(existingDemo.prisma, variables)).resolves.toBe('demo+__demo__@example.invalid');
    expect(existingDemo.create).not.toHaveBeenCalled();

    const existingOwner = prismaFor({ role: StaffRole.OWNER });
    await expect(seedDemoAccount(existingOwner.prisma, variables)).rejects.toThrow('will not change');
  });

  it('rejects missing credentials and untagged emails', async () => {
    await expect(
      seedDemoAccount(prismaFor().prisma, { SEED_DEMO_EMAIL: 'demo@example.invalid', SEED_DEMO_PASSWORD: 'long-enough-password' }),
    ).rejects.toThrow('__demo__');

    await expect(
      seedDemoAccount(prismaFor().prisma, { SEED_DEMO_EMAIL: 'demo+__demo__@example.invalid', SEED_DEMO_PASSWORD: 'short' }),
    ).rejects.toThrow('at least 12');
  });
});
