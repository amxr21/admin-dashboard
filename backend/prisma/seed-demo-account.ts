import bcrypt from 'bcryptjs';
import { PrismaClient, StaffRole } from '@prisma/client';

import { accountEmailSchema } from '../src/lib/identity-validation.js';
import { DEMO_TAG } from './demo-data.js';

/**
 * Creates the read-only account used for customer demonstrations.
 *
 * The credentials are deliberately required from the environment. A checked-in
 * demo password eventually becomes a real password when a public demo is copied.
 * The email must carry the demo tag so demo-teardown.ts can remove it safely.
 */
export async function seedDemoAccount(
  prisma: PrismaClient,
  variables: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const parsedEmail = accountEmailSchema.safeParse(variables.SEED_DEMO_EMAIL);
  if (!parsedEmail.success || !parsedEmail.data.includes(DEMO_TAG)) {
    throw new Error(
      `SEED_DEMO_EMAIL must be a valid email containing ${DEMO_TAG} so teardown can identify it.`,
    );
  }

  const password = variables.SEED_DEMO_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error('SEED_DEMO_PASSWORD must be at least 12 characters for a new account.');
  }

  const email = parsedEmail.data;
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { role: true },
  });

  if (existing) {
    if (existing.role !== StaffRole.DEMO) {
      throw new Error(
        `The demo seed email ${email} already belongs to a ${existing.role} account. ` +
          'Choose a distinct demo email; the seed will not change an existing role.',
      );
    }
    return email;
  }

  await prisma.user.create({
    data: {
      email,
      name: variables.SEED_DEMO_NAME?.trim() || 'Demo',
      role: StaffRole.DEMO,
      passwordHash: await bcrypt.hash(password, 12),
    },
  });

  return email;
}
