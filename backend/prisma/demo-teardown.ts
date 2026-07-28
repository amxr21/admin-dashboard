import { PrismaClient } from '@prisma/client';

import { DEMO_TAG } from './demo-data.js';

/**
 * Removes everything demo-seed.ts created, and nothing else.
 *
 *   pnpm --filter ./backend exec tsx prisma/demo-teardown.ts
 *   pnpm --filter ./backend exec tsx prisma/demo-teardown.ts --dry-run
 *
 * ─── THE ONLY RULE THAT MATTERS ──────────────────────────────────────
 * Every delete is filtered on the tag. There is no "delete everything created
 * after X", no "truncate", no "delete where name looks generated". If a row
 * does not carry the tag, this script cannot reach it — which means running it
 * against a database with real data in it is safe, even by accident.
 *
 * That property is worth more than convenience. It is the difference between a
 * cleanup script people run without thinking and one they avoid because they
 * are not sure what it does.
 *
 * ─── ORDER MATTERS ───────────────────────────────────────────────────
 * Children before parents where the relation is not `Cascade`. Where it IS
 * cascade (order items, status history, stock movements, assignments), the
 * parent delete takes them — but they are counted first so the summary is
 * honest about what is going.
 */

const prisma = new PrismaClient();

const dryRun = process.argv.includes('--dry-run');

function assertSafeEnvironment() {
  if (process.env.NODE_ENV === 'production' && !dryRun) {
    throw new Error(
      'Refusing to delete with NODE_ENV=production. Use --dry-run to inspect.',
    );
  }

  const url = process.env.DATABASE_URL ?? '';
  const database = /\/([^/?]+)(\?|$)/.exec(url)?.[1];

  if (!database) {
    throw new Error('Could not determine the target database from DATABASE_URL.');
  }

  process.stdout.write(`  target database: ${database}\n`);
  process.stdout.write(`  mode: ${dryRun ? 'DRY RUN — nothing will be deleted' : 'DELETE'}\n\n`);
}

/** Filters. Each one matches ONLY rows carrying the tag. */
const WHERE = {
  product: { sku: { startsWith: DEMO_TAG } },
  order: { orderNumber: { startsWith: DEMO_TAG } },
  customer: { email: { contains: DEMO_TAG } },
  courier: { email: { contains: DEMO_TAG } },
  category: { slug: { startsWith: DEMO_TAG } },
  discount: { code: { startsWith: DEMO_TAG } },
  notification: { body: { contains: DEMO_TAG } },
} as const;

async function main() {
  assertSafeEnvironment();

  /* Count first, so the summary describes what WOULD go as well as what did. */
  const [products, orders, customers, couriers, categories, discounts, notifications] =
    await Promise.all([
      prisma.product.findMany({ where: WHERE.product, select: { id: true } }),
      prisma.order.findMany({ where: WHERE.order, select: { id: true } }),
      prisma.customer.findMany({ where: WHERE.customer, select: { id: true } }),
      prisma.deliveryStaff.findMany({ where: WHERE.courier, select: { id: true } }),
      prisma.category.findMany({ where: WHERE.category, select: { id: true } }),
      prisma.discount.findMany({ where: WHERE.discount, select: { id: true } }),
      prisma.notification.findMany({ where: WHERE.notification, select: { id: true } }),
    ]);

  const productIds = products.map((row) => row.id);
  const orderIds = orders.map((row) => row.id);

  // Cascading children, counted so the report is not misleading about volume.
  const [items, history, movements, assignments, reviews] = await Promise.all([
    prisma.orderItem.count({ where: { orderId: { in: orderIds } } }),
    prisma.orderStatusHistory.count({ where: { orderId: { in: orderIds } } }),
    prisma.stockMovement.count({ where: { productId: { in: productIds } } }),
    prisma.deliveryAssignment.count({ where: { orderId: { in: orderIds } } }),
    prisma.review.count({ where: { productId: { in: productIds } } }),
  ]);

  const plan: [string, number][] = [
    ['orders', orders.length],
    ['  └ order items (cascade)', items],
    ['  └ status history (cascade)', history],
    ['  └ delivery assignments (cascade)', assignments],
    ['products', products.length],
    ['  └ stock movements (cascade)', movements],
    ['  └ reviews (cascade)', reviews],
    ['customers', customers.length],
    ['couriers', couriers.length],
    ['categories', categories.length],
    ['discounts', discounts.length],
    ['notifications', notifications.length],
  ];

  for (const [label, count] of plan) {
    process.stdout.write(`  ${label.padEnd(36)} ${String(count).padStart(5)}\n`);
  }

  const total = plan.reduce((sum, [, count]) => sum + count, 0);

  if (total === 0) {
    process.stdout.write('\n  Nothing tagged as demo data. Nothing to do.\n');
    return;
  }

  if (dryRun) {
    process.stdout.write(`\n  DRY RUN — ${String(total)} rows would be deleted.\n`);
    return;
  }

  /**
   * One transaction: a half-removed demo is worse than either state, because
   * orders referencing deleted products would render as nameless rows and look
   * like a bug in the app rather than an interrupted script.
   */
  await prisma.$transaction([
    // Reviews and assignments cascade, but customers do NOT cascade from
    // orders (SetNull), so orders go first to avoid orphaning nothing.
    prisma.order.deleteMany({ where: WHERE.order }),
    prisma.review.deleteMany({ where: { productId: { in: productIds } } }),
    prisma.product.deleteMany({ where: WHERE.product }),
    prisma.customer.deleteMany({ where: WHERE.customer }),
    prisma.deliveryStaff.deleteMany({ where: WHERE.courier }),
    prisma.category.deleteMany({ where: WHERE.category }),
    prisma.discount.deleteMany({ where: WHERE.discount }),
    prisma.notification.deleteMany({ where: WHERE.notification }),
  ]);

  /* Verify, rather than assume. */
  const remaining = await prisma.product.count({ where: WHERE.product });

  process.stdout.write(
    `\n  removed ${String(total)} rows. Demo products remaining: ${String(remaining)}\n`,
  );

  if (remaining > 0) {
    throw new Error('Teardown finished but demo rows remain — investigate before re-seeding.');
  }
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `\n  teardown failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
