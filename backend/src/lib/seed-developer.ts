import { PrismaClient, StaffRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

import { accountEmailSchema } from './identity-validation.js';

/** Bootstrap only the operator account. Client owners are invited separately. */
export async function seedDeveloperUser(
  prisma: PrismaClient,
  variables: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const parsedEmail = accountEmailSchema.safeParse(variables.SEED_DEVELOPER_EMAIL);
  if (!parsedEmail.success) {
    throw new Error('SEED_DEVELOPER_EMAIL must be a valid email address.');
  }

  const email = parsedEmail.data;
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { role: true },
  });

  if (existing) {
    if (existing.role !== StaffRole.DEVELOPER) {
      throw new Error(
        `The seed email ${email} already belongs to a ${existing.role} account. ` +
          'Choose a distinct developer email; the seed will not change an existing role.',
      );
    }
    return email;
  }

  const password = variables.SEED_DEVELOPER_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error('SEED_DEVELOPER_PASSWORD must be at least 12 characters for a new account.');
  }

  await prisma.user.create({
    data: {
      email,
      name: variables.SEED_DEVELOPER_NAME?.trim() || 'Developer',
      role: StaffRole.DEVELOPER,
      passwordHash: await bcrypt.hash(password, 12),
    },
  });

  return email;
}
