#!/usr/bin/env node

// Opt-in, disposable reproduction for URG-004. Never points Prisma at the
// application's database for migrations; it only creates/drops a random local
// test database. No customer or production rows are read.
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { runMigrationDataCheck } from './check-migration-data.mjs';
import { runProductionStart } from './start-production.mjs';

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceMigrations = join(backendDir, 'prisma/migrations');
const sourceSchema = join(backendDir, 'prisma/schema.prisma');
const prismaCli = join(backendDir, 'node_modules/prisma/build/index.js');
const omitted = '20260911100000_backfill_catalogue_version_baselines';
const scratchRoot = join(backendDir, '..', '.claude-workbook', 'migration-repro');

function requireLocalUrl() {
  if (process.env.RUN_DISPOSABLE_MIGRATION_REPRO !== '1') {
    throw new Error('Set RUN_DISPOSABLE_MIGRATION_REPRO=1 to run this disposable-DB check.');
  }
  config({ path: join(backendDir, '.env') });
  if ((process.env.APP_MODE || 'local') !== 'local') {
    throw new Error('APP_MODE must be local.');
  }
  const raw = process.env.DATABASE_URL_LOCAL;
  if (!raw) throw new Error('DATABASE_URL_LOCAL is required.');
  const url = new URL(raw);
  if (url.protocol !== 'mysql:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('DATABASE_URL_LOCAL must point to loopback MySQL.');
  }
  if (url.pathname.slice(1) !== 'admin_dashboard') {
    throw new Error('Expected the local admin_dashboard connection as the database creator.');
  }
  return url;
}

function client(url) {
  return new PrismaClient({ datasources: { db: { url: url.toString() } } });
}

async function prisma(args, url) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [prismaCli, ...args], {
      cwd: backendDir,
      env: {
        ...process.env,
        APP_MODE: 'local',
        DATABASE_URL_LOCAL: url.toString(),
        DATABASE_URL: url.toString(),
      },
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`Prisma stopped by ${signal}`));
      else done(code ?? 1);
    });
  });
}

async function main() {
  const creatorUrl = requireLocalUrl();
  const name = `test_urgent_migration_${randomBytes(5).toString('hex')}`;
  const healthyName = `test_urgent_migration_${randomBytes(5).toString('hex')}`;
  const disposableUrl = new URL(creatorUrl);
  disposableUrl.pathname = `/${name}`;
  const healthyUrl = new URL(creatorUrl);
  healthyUrl.pathname = `/${healthyName}`;
  await mkdir(scratchRoot, { recursive: true });
  const scratch = await mkdtemp(join(scratchRoot, 'run-'));
  if (!scratch.startsWith(resolve(scratchRoot) + '\\')) {
    throw new Error('Scratch path escaped the reproduction directory.');
  }
  const testPrismaDir = join(scratch, 'prisma');
  const testMigrations = join(testPrismaDir, 'migrations');
  const testSchema = join(testPrismaDir, 'schema.prisma');
  const creator = client(creatorUrl);
  let disposable;
  let created = false;
  let healthyCreated = false;
  try {
    await creator.$executeRawUnsafe(`CREATE DATABASE \`${name}\``);
    created = true;
    await mkdir(testMigrations, { recursive: true });
    await cp(sourceSchema, testSchema);
    await cp(join(sourceMigrations, 'migration_lock.toml'), join(testMigrations, 'migration_lock.toml'));
    const directories = (await readdir(sourceMigrations, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    if (!directories.includes(omitted)) throw new Error('Expected data-only migration is absent.');
    const copyMigration = async (nameToCopy) => {
      await cp(join(sourceMigrations, nameToCopy), join(testMigrations, nameToCopy), { recursive: true });
    };
    for (const directory of directories.filter((nameToCopy) => nameToCopy < omitted)) {
      await copyMigration(directory);
    }
    if (await prisma(['migrate', 'deploy', '--schema', testSchema], disposableUrl) !== 0) {
      throw new Error('Pre-backfill migrations failed on the disposable DB.');
    }

    disposable = client(disposableUrl);
    const productId = `migration-repro-${randomBytes(6).toString('hex')}`;
    await disposable.$executeRaw`INSERT INTO products (id, name, price, status, stock, created_at, updated_at)
      VALUES (${productId}, 'Disposable baseline probe', 1, 'ACTIVE', 0, NOW(3), NOW(3))`;
    for (const directory of directories.filter((nameToCopy) => nameToCopy > omitted)) {
      await copyMigration(directory);
    }
    if (await prisma(['migrate', 'deploy', '--schema', testSchema], disposableUrl) !== 0) {
      throw new Error('Post-backfill migrations failed on the disposable DB.');
    }
    const shape = await prisma([
      'migrate', 'diff', '--from-schema-datasource', testSchema,
      '--to-schema-datamodel', testSchema, '--exit-code',
    ], disposableUrl);
    if (shape !== 0) throw new Error(`Expected matching live schema, got exit ${shape}.`);
    const data = await runMigrationDataCheck({ db: disposable, report: () => {} });
    disposable = undefined; // the check disconnects its injected client
    if (data !== 2) throw new Error(`Expected missing-backfill exit 2, got ${data}.`);

    disposable = client(disposableUrl);
    await disposable.$executeRawUnsafe('ALTER TABLE `products` ADD COLUMN `disposable_schema_drift` INT NULL');
    const schemaDrift = await prisma([
      'migrate', 'diff', '--from-schema-datasource', testSchema,
      '--to-schema-datamodel', testSchema, '--exit-code',
    ], disposableUrl);
    if (schemaDrift !== 2) throw new Error(`Expected live-schema drift exit 2, got ${schemaDrift}.`);
    let driftServed = false;
    const driftAdmission = await runProductionStart({
      migrate: async () => 0,
      verify: async () => 0,
      verifySchema: async () => schemaDrift,
      verifyData: async () => { throw new Error('Data check must not run after schema drift.'); },
      startServer: async () => { driftServed = true; },
      log: () => {},
    });
    if (driftAdmission !== 2 || driftServed) throw new Error('Startup admitted live-schema drift.');
    await disposable.$executeRawUnsafe('ALTER TABLE `products` DROP COLUMN `disposable_schema_drift`');

    const unavailableUrl = new URL(disposableUrl);
    unavailableUrl.pathname = `/test_urgent_missing_${randomBytes(5).toString('hex')}`;
    const unavailable = await runMigrationDataCheck({
      db: client(unavailableUrl),
      report: () => {},
    });
    if (unavailable !== 1) throw new Error(`Expected unavailable data-check exit 1, got ${unavailable}.`);
    let unavailableServed = false;
    const unavailableAdmission = await runProductionStart({
      migrate: async () => 1,
      verify: async () => 1,
      verifySchema: async () => 0,
      verifyData: async () => unavailable,
      startServer: async () => { unavailableServed = true; },
      log: () => {},
    });
    if (unavailableAdmission !== 1 || unavailableServed) {
      throw new Error('Startup admitted an unavailable data check.');
    }

    await disposable.$executeRawUnsafe('DROP TABLE `_prisma_migrations`');
    await disposable.$disconnect();
    disposable = undefined;
    const history = await prisma(['migrate', 'status', '--schema', testSchema], disposableUrl);
    if (history === 0) throw new Error('Missing migration history was not detected.');
    const shapeWithoutHistory = await prisma([
      'migrate', 'diff', '--from-schema-datasource', testSchema,
      '--to-schema-datamodel', testSchema, '--exit-code',
    ], disposableUrl);
    if (shapeWithoutHistory !== 0) throw new Error('Dropping history unexpectedly changed schema shape.');
    let served = false;
    const admission = await runProductionStart({
      migrate: async () => 1,
      verify: async () => history,
      verifySchema: async () => shapeWithoutHistory,
      verifyData: async () => data,
      startServer: async () => { served = true; },
      log: () => {},
    });
    if (admission !== 2 || served) throw new Error('Startup admitted a missing-backfill database.');

    // A fully migrated empty database is the control case: history and shape
    // both pass, and startup must serve without entering the exceptional data
    // review path. It lives in a second random disposable database.
    await creator.$executeRawUnsafe(`CREATE DATABASE \`${healthyName}\``);
    healthyCreated = true;
    await copyMigration(omitted);
    if (await prisma(['migrate', 'deploy', '--schema', testSchema], healthyUrl) !== 0) {
      throw new Error('Full migrations failed on the healthy control DB.');
    }
    const healthyHistory = await prisma(['migrate', 'status', '--schema', testSchema], healthyUrl);
    const healthyShape = await prisma([
      'migrate', 'diff', '--from-schema-datasource', testSchema,
      '--to-schema-datamodel', testSchema, '--exit-code',
    ], healthyUrl);
    if (healthyHistory !== 0 || healthyShape !== 0) {
      throw new Error(`Healthy control failed: history=${healthyHistory}, shape=${healthyShape}.`);
    }
    let healthyServed = false;
    const healthyAdmission = await runProductionStart({
      migrate: async () => 0,
      verify: async () => healthyHistory,
      verifySchema: async () => healthyShape,
      verifyData: async () => { throw new Error('Healthy history must not enter data review.'); },
      startServer: async () => { healthyServed = true; },
      log: () => {},
    });
    if (healthyAdmission !== 0 || !healthyServed) throw new Error('Healthy control failed admission.');
    process.stdout.write(
      '[migration-repro] PASS: omitted data-only backfill, matching live schema, ' +
      'missing migration history, live-schema drift and unavailable data check ' +
      'refused startup; complete migration history admitted the healthy control.\n',
    );
  } finally {
    await disposable?.$disconnect();
    if (created) await creator.$executeRawUnsafe(`DROP DATABASE \`${name}\``);
    if (healthyCreated) await creator.$executeRawUnsafe(`DROP DATABASE \`${healthyName}\``);
    await creator.$disconnect();
    await rm(scratch, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`[migration-repro] FAIL: ${error.message}\n`);
  process.exitCode = 1;
});
