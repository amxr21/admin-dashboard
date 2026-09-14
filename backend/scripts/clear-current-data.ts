/**
 * One-time application-data clear, prepared for review. NEVER invoked by seed or deploy.
 * Run only through `pnpm --filter ./backend data:clear:plan` first.
 *
 * This deletes ALL application rows, including users, settings, and audit history.
 * It preserves tables and `_prisma_migrations`. Take and verify an isolated
 * backup, stop app writes, then bootstrap fresh Developer and Demo accounts.
 */
import { createHash } from 'node:crypto';

import { Prisma, PrismaClient } from '@prisma/client';

import { deletionOrder, IMPLICIT_JOIN_TABLES, reconcileTables } from '../src/lib/data-clear-plan.js';

type TableRow = { tableName: string };
type ForeignKeyRow = { child: string; parent: string; columnName: string; nullable: 'YES' | 'NO' };
type CountRow = { count: bigint };
type CaseModeRow = { lowerCaseTableNames: bigint | number };

const prisma = new PrismaClient();
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MIGRATIONS_TABLE = '_prisma_migrations';

function flag(name: string): string | undefined {
  const matches = process.argv.flatMap((arg, index) => arg === name ? [index] : []);
  if (matches.length > 1) throw new Error(`Duplicate argument: ${name}`);
  const value = matches.length ? process.argv[matches[0]! + 1] : undefined;
  return value && !value.startsWith('--') ? value : undefined;
}

function tableIdentifier(name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`Unexpected table identifier: ${name}`);
  return `\`${name}\``;
}

async function tableCount(table: string, client: PrismaClient | Prisma.TransactionClient): Promise<bigint> {
  const rows = await client.$queryRawUnsafe<CountRow[]>(
    `SELECT COUNT(*) AS count FROM ${tableIdentifier(table)}`,
  );
  const count = rows[0]?.count;
  if (count === undefined) throw new Error(`Cannot count ${table}`);
  return BigInt(count);
}

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');
  const allowed = new Set([
    '--plan', '--execute', '--expect-plan', '--confirm', '--backup-ref', '--maintenance-confirmed',
  ]);
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (!allowed.has(arg)) throw new Error(`Unknown argument: ${arg}`);
    if (['--expect-plan', '--confirm', '--backup-ref'].includes(arg)) i += 1;
  }
  if (execute && process.argv.includes('--plan')) throw new Error('Choose --plan or --execute');
  if (!process.env.APP_MODE) throw new Error('Set APP_MODE explicitly before planning a data clear');
  if (!process.env.DATABASE_URL) throw new Error('Run through with-db-url.mjs');

  const target = new URL(process.env.DATABASE_URL);
  const database = decodeURIComponent(target.pathname.replace(/^\//, ''));
  if (!database || !target.hostname) throw new Error('Database target is incomplete');
  const targetLabel = `${target.hostname}/${database}`;

  const modelTables = [
    ...Prisma.dmmf.datamodel.models.map((model) => model.dbName ?? model.name),
    ...IMPLICIT_JOIN_TABLES,
  ];
  const expected = [...modelTables, MIGRATIONS_TABLE];

  const caseRows = await prisma.$queryRaw<CaseModeRow[]>`SELECT @@lower_case_table_names AS lowerCaseTableNames`;
  const caseMode = Number(caseRows[0]?.lowerCaseTableNames);
  if (![0, 1, 2].includes(caseMode)) throw new Error('Cannot determine MySQL table-name case mode');

  const live = await prisma.$queryRaw<TableRow[]>`
    SELECT TABLE_NAME AS tableName FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
  `;
  const { missing, extra, canonical } = reconcileTables(
    expected, live.map((row) => row.tableName), caseMode !== 0,
  );
  if (missing.length || extra.length) {
    throw new Error(`Schema differs from generated Prisma Client; missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'}`);
  }

  const rawForeignKeys = await prisma.$queryRaw<ForeignKeyRow[]>`
    SELECT k.TABLE_NAME AS child, k.REFERENCED_TABLE_NAME AS parent,
           k.COLUMN_NAME AS columnName, c.IS_NULLABLE AS nullable
    FROM information_schema.KEY_COLUMN_USAGE k
    JOIN information_schema.COLUMNS c
      ON c.TABLE_SCHEMA = k.TABLE_SCHEMA
     AND c.TABLE_NAME = k.TABLE_NAME AND c.COLUMN_NAME = k.COLUMN_NAME
    WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL
  `;
  const foreignKeys = rawForeignKeys.map((key) => ({
    ...key, child: canonical(key.child), parent: canonical(key.parent),
  }));
  const selfReferences = foreignKeys.filter((key) => key.child === key.parent);
  if (selfReferences.some((key) => key.nullable !== 'YES')) {
    throw new Error('Non-nullable self-reference needs a reviewed deletion plan');
  }
  const order = deletionOrder(modelTables, foreignKeys.filter((key) => key.child !== key.parent));
  const counts = await Promise.all(order.map(async (table) => [table, await tableCount(table, prisma)] as const));
  const planHash = createHash('sha256')
    .update(JSON.stringify({ targetLabel, mode: process.env.APP_MODE, counts: counts.map(([table, count]) => [table, String(count)]) }))
    .digest('hex');
  const total = counts.reduce((sum, [, count]) => sum + count, 0n);

  process.stdout.write(`Target: ${targetLabel} (APP_MODE=${process.env.APP_MODE})\n`);
  process.stdout.write('Scope: every application table; users, settings and audit history included.\n');
  process.stdout.write('Preserved: schema and _prisma_migrations. No table is truncated.\n');
  for (const [table, count] of counts) process.stdout.write(`  ${table}: ${String(count)}\n`);
  process.stdout.write(`Total rows: ${String(total)}\nPlan SHA-256: ${planHash}\n`);

  if (!execute) {
    process.stdout.write('PLAN ONLY. Nothing was deleted.\n');
    return;
  }

  if (!process.argv.includes('--maintenance-confirmed')) {
    throw new Error('Stop application writes, then pass --maintenance-confirmed');
  }
  if (!flag('--backup-ref')?.trim()) throw new Error('A verified restore backup reference is required');
  if (flag('--confirm') !== `CLEAR ${targetLabel}`) throw new Error(`Confirmation must be exactly: CLEAR ${targetLabel}`);
  if (flag('--expect-plan') !== planHash) throw new Error('Plan changed; inspect a new dry run before executing');
  if (total === 0n) {
    process.stdout.write('No application rows to delete.\n');
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const [table, count] of counts) {
      if (await tableCount(table, tx) !== count) {
        throw new Error(`Row count changed in ${table}; aborting the clear`);
      }
    }
    // Break nullable self-links (currently Category.parentId) before deleting
    // the table, while foreign-key checks remain enabled throughout.
    for (const key of selfReferences) {
      await tx.$executeRawUnsafe(
        `UPDATE ${tableIdentifier(key.child)} SET ${tableIdentifier(key.columnName)} = NULL WHERE ${tableIdentifier(key.columnName)} IS NOT NULL`,
      );
    }
    for (const table of order) {
      await tx.$executeRawUnsafe(`DELETE FROM ${tableIdentifier(table)}`);
    }
    for (const table of order) {
      if (await tableCount(table, tx) !== 0n) throw new Error(`Rows remain in ${table}; rolling back`);
    }
  }, { maxWait: 30_000, timeout: 600_000 });

  process.stdout.write('Application rows cleared. Re-seed Developer and Demo before restoring app access.\n');
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`Data clear refused: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => { void prisma.$disconnect(); });
