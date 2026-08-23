/**
 * Seed script — the single entrypoint that makes an empty database usable.
 *
 * Run with: pnpm --filter ./backend db:seed
 *
 * Two things happen, in order:
 *   1. The admin account, from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD.
 *   2. The tagged demo dataset (prisma/demo-seed.ts), unless SEED_DEMO_DATA=0.
 *
 * ─── WHY THE DEMO DATA MOVED HERE ────────────────────────────────────
 * This script used to write its own small catalogue of sample products,
 * customers and orders. Those rows carried NO `__demo__` tag, so
 * demo-teardown.ts — which matches the tag and nothing else — could not
 * remove them, and cleaning up meant deleting rows by hand through the UI.
 * The demo seeder already produces a strictly better dataset (180 days of
 * history, deterministic, fully tagged, reversible), so the untagged copy is
 * gone and this delegates to it instead. One command, one dataset, one
 * teardown that actually works.
 *
 * SAFE TO RE-RUN for the admin user: it is an upsert and never resets an
 * existing password. The demo half refuses to run twice (it would double every
 * figure in the reports) — run `pnpm demo:teardown` first to reseed it.
 *
 * The admin password comes from the environment with no hardcoded fallback, on
 * purpose: a default password that works in production is how dashboards get
 * breached.
 */
import 'dotenv/config';

import { PrismaClient, StaffRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

import { DEMO_TAG } from './demo-data.js';
import { seedDemoData } from './demo-seed.js';

const prisma = new PrismaClient();

async function seedAdminUser(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!password) {
    throw new Error(
      'SEED_ADMIN_PASSWORD is required. Set it in backend/.env before seeding — ' +
        'there is deliberately no default, so a known password can never reach production.',
    );
  }

  if (password.length < 12) {
    throw new Error('SEED_ADMIN_PASSWORD must be at least 12 characters.');
  }

  // Cost 12: ~250ms per hash on modern hardware. Slow enough to make offline
  // brute-forcing expensive, fast enough not to be a login bottleneck.
  const passwordHash = await bcrypt.hash(password, 12);

  const name = process.env.SEED_ADMIN_NAME ?? 'Admin';

  await prisma.user.upsert({
    where: { email },
    // Never reset an existing admin's password on re-seed — that would silently
    // lock someone out of a running environment.
    update: {},
    create: { email, name, role: StaffRole.OWNER, passwordHash },
  });

  console.log(`✔ admin user: ${email}`);
}

async function main(): Promise<void> {
  await seedAdminUser();

  // Opt-OUT rather than opt-in: an empty dashboard is the less useful default
  // for both local development and the public demo instance, which are the two
  // places this ever runs. A real client deployment sets SEED_DEMO_DATA=0.
  if (process.env.SEED_DEMO_DATA === '0') {
    console.log('  demo data skipped (SEED_DEMO_DATA=0)');
    console.log('\nSeed complete.');
    return;
  }

  // Re-running the whole seed to fix an admin typo should not fail just because
  // the demo rows are already there. The admin upsert above has done its job;
  // report the skip and exit clean.
  const alreadySeeded = await prisma.product.count({
    where: { sku: { startsWith: DEMO_TAG } },
  });

  if (alreadySeeded > 0) {
    console.log(
      `  demo data already present (${String(alreadySeeded)} products) — skipped.\n` +
        '  To rebuild it: pnpm --filter ./backend demo:teardown, then seed again.',
    );
    console.log('\nSeed complete.');
    return;
  }

  await seedDemoData();
  console.log('\nSeed complete.');
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
