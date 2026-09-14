/**
 * Bootstrap the first Developer operator without creating business or demo data.
 * Run with: pnpm --filter ./backend db:seed
 *
 * SEED_DEVELOPER_EMAIL and SEED_DEVELOPER_PASSWORD are required for a new
 * account. Re-running preserves an existing Developer's password and refuses
 * to promote an account with another role. Demo fixtures use `demo:seed`.
 */
import 'dotenv/config';

import { PrismaClient } from '@prisma/client';

import { seedDeveloperUser } from '../src/lib/seed-developer.js';

const prisma = new PrismaClient();

seedDeveloperUser(prisma)
  .then(() => { process.stdout.write('Developer user ready.\n'); })
  .catch((error: unknown) => {
    process.stderr.write(`Seed failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => { void prisma.$disconnect(); });
