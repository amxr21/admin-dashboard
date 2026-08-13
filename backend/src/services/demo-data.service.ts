import { prisma } from '../db/prisma.js';

/**
 * Danger zone → "Delete test data" (B3.4).
 *
 * ─── SAME TAG CONTRACT AS `prisma/demo-seed.ts` / `prisma/demo-teardown.ts` ──
 * Every demo row carries `__demo__` in a column that is already unique or
 * indexed (`sku`, `orderNumber`, `email`, `slug`, `code`). Deletion filters on
 * THAT and nothing else — no date range, no "looks generated" heuristic — so
 * this can never remove a real row, even by accident. The constant is
 * duplicated here rather than imported from `prisma/demo-data.ts`: that file
 * lives outside `src/`'s `rootDir`, and re-pointing `tsc`'s build at it for
 * one string is a worse trade than keeping five characters in sync by hand.
 *
 * The CLI scripts (`pnpm demo:teardown`) remain the tool for local dev — this
 * is the same operation reachable from the Danger Zone UI, gated behind
 * OWNER/DEVELOPER auth and a typed confirmation, for a deployed environment
 * where nobody has a terminal open.
 */

const DEMO_TAG = '__demo__';

const WHERE = {
  product: { sku: { startsWith: DEMO_TAG } },
  order: { orderNumber: { startsWith: DEMO_TAG } },
  customer: { email: { contains: DEMO_TAG } },
  courier: { email: { contains: DEMO_TAG } },
  category: { slug: { startsWith: DEMO_TAG } },
  discount: { code: { startsWith: DEMO_TAG } },
  notification: { body: { contains: DEMO_TAG } },
} as const;

export interface DemoDataSummary {
  orders: number;
  products: number;
  customers: number;
  couriers: number;
  categories: number;
  discounts: number;
  notifications: number;
  total: number;
}

async function countDemoRows(): Promise<DemoDataSummary> {
  const [orders, products, customers, couriers, categories, discounts, notifications] =
    await Promise.all([
      prisma.order.count({ where: WHERE.order }),
      prisma.product.count({ where: WHERE.product }),
      prisma.customer.count({ where: WHERE.customer }),
      prisma.deliveryStaff.count({ where: WHERE.courier }),
      prisma.category.count({ where: WHERE.category }),
      prisma.discount.count({ where: WHERE.discount }),
      prisma.notification.count({ where: WHERE.notification }),
    ]);

  const total = orders + products + customers + couriers + categories + discounts + notifications;

  return { orders, products, customers, couriers, categories, discounts, notifications, total };
}

/** What a delete WOULD remove, without removing it — powers the confirmation dialog's copy. */
export async function previewDemoData(): Promise<DemoDataSummary> {
  return countDemoRows();
}

/**
 * Deletes every tagged row, transactionally.
 *
 * Order matches `demo-teardown.ts`: orders before products/customers (orders
 * reference both but neither cascades from an order — `Customer` and
 * `Product` use `SetNull`/`Restrict`, not `Cascade`, so deleting the order
 * first avoids ever orphaning a reference mid-transaction). Reviews are
 * deleted explicitly for the same reason — they hang off `productId`, not
 * off the order, and outlive an order delete on their own.
 */
export async function deleteDemoData(): Promise<DemoDataSummary> {
  const before = await countDemoRows();

  if (before.total === 0) return before;

  const productIds = (
    await prisma.product.findMany({ where: WHERE.product, select: { id: true } })
  ).map((row) => row.id);

  await prisma.$transaction([
    prisma.order.deleteMany({ where: WHERE.order }),
    prisma.review.deleteMany({ where: { productId: { in: productIds } } }),
    prisma.product.deleteMany({ where: WHERE.product }),
    prisma.customer.deleteMany({ where: WHERE.customer }),
    prisma.deliveryStaff.deleteMany({ where: WHERE.courier }),
    prisma.category.deleteMany({ where: WHERE.category }),
    prisma.discount.deleteMany({ where: WHERE.discount }),
    prisma.notification.deleteMany({ where: WHERE.notification }),
  ]);

  return before;
}
