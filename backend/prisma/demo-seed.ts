import {
  DeliveryStaffStatus,
  DeliveryStatus,
  DiscountType,
  OrderStatus,
  Prisma,
  PrismaClient,
  ProductStatus,
  ReviewStatus,
  StockMovementReason,
} from '@prisma/client';

import { DEMO, DEMO_TAG, makeRandom } from './demo-data.js';

/**
 * Fills the database with a realistic business, so the dashboard has something
 * true to show.
 *
 *   pnpm --filter ./backend exec tsx prisma/demo-seed.ts
 *   pnpm --filter ./backend exec tsx prisma/demo-teardown.ts   ← removes it
 *
 * ─── WHY REAL ROWS AND NOT FIXTURES ──────────────────────────────────
 * Static sample data in the frontend proves the layout renders. It proves
 * nothing about pagination, sorting, search, aggregation, empty pages, or a
 * chart with an awkward gap in it — and it cannot, because none of that code
 * runs. The dashboard shipped a fabricated sine wave for exactly this reason
 * and nobody noticed until someone read the file.
 *
 * Writing rows exercises the whole stack: the reports GROUP BY, the low-stock
 * threshold, the movement log reconciling, RBAC filtering, the resource
 * engine's search. If any of those is wrong, this makes it visible.
 *
 * ─── EVERY ROW IS TAGGED ─────────────────────────────────────────────
 * See demo-data.ts. Teardown matches the tag and nothing else, so it can never
 * remove something real.
 *
 * ─── DETERMINISTIC ───────────────────────────────────────────────────
 * Seeded RNG, so two runs produce identical data. A demo that reshuffles makes
 * "did that number change because of my change?" unanswerable.
 */

const prisma = new PrismaClient();
const random = makeRandom(20260727);

/** Six months, so week and month granularity both have something to show. */
const DAYS_OF_HISTORY = 180;
const ORDER_COUNT = 140;

const CATEGORIES = [
  { name: 'Home & Garden', slug: 'home-garden' },
  { name: 'Electronics', slug: 'electronics' },
  { name: 'Apparel', slug: 'apparel' },
  { name: 'Kitchen', slug: 'kitchen' },
  { name: 'Stationery', slug: 'stationery' },
] as const;

const PRODUCT_NAMES: Record<string, readonly string[]> = {
  'home-garden': ['Ceramic Planter', 'Rattan Basket', 'Wall Mirror', 'Linen Cushion', 'Brass Watering Can'],
  electronics: ['Wireless Headphones', 'Mechanical Keyboard', 'USB-C Hub', 'Desk Lamp', 'Portable SSD'],
  apparel: ['Cotton T-Shirt', 'Denim Jacket', 'Wool Scarf', 'Canvas Tote', 'Leather Belt'],
  kitchen: ['Cast Iron Pan', 'Ceramic Mug Set', 'Chopping Board', 'French Press', 'Spice Rack'],
  stationery: ['Notebook A5', 'Fountain Pen', 'Desk Organiser', 'Sticky Notes', 'Leather Folio'],
};

const FIRST_NAMES = ['Ammar', 'Layla', 'Omar', 'Sara', 'Yousef', 'Hana', 'Khalid', 'Noor', 'Tariq', 'Dana'];
const LAST_NAMES = ['Haddad', 'Nasser', 'Rahman', 'Aziz', 'Farouk', 'Sultan', 'Karim', 'Mansour'];
const CITIES = ['Dubai', 'Abu Dhabi', 'Sharjah', 'Riyadh', 'Doha', 'Manama'];

function daysAgo(days: number): Date {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - days);
  return date;
}

function money(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(2));
}

/**
 * Refuses to run anywhere it could do damage.
 *
 * A seeder is the one script most likely to be run by muscle memory in the
 * wrong terminal, and the damage is silent — a production catalogue with
 * `__demo__` products in it looks like a data-entry mistake, not a script.
 */
function assertSafeEnvironment() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed demo data with NODE_ENV=production.');
  }

  const url = process.env.DATABASE_URL ?? '';
  const database = /\/([^/?]+)(\?|$)/.exec(url)?.[1];

  if (!database) {
    throw new Error('Could not determine the target database from DATABASE_URL.');
  }

  // The template's live data lives in `defaultdb` on the SAME Aiven service.
  // Naming it explicitly is cheap insurance against a copied .env.
  if (database === 'defaultdb') {
    throw new Error(
      'Refusing to seed: `defaultdb` holds another project\'s live tables.',
    );
  }

  process.stdout.write(`  target database: ${database}\n`);
}

async function main() {
  assertSafeEnvironment();

  const existing = await prisma.product.count({
    where: { sku: { startsWith: DEMO_TAG } },
  });

  if (existing > 0) {
    throw new Error(
      `${String(existing)} demo products already exist. Run demo-teardown.ts first — ` +
        'seeding twice would double every figure in the reports.',
    );
  }

  /* ── Categories ─────────────────────────────────────────────────── */
  const categories = await Promise.all(
    CATEGORIES.map((category) =>
      prisma.category.create({
        data: {
          name: category.name,
          slug: DEMO.categorySlug(category.slug),
          isActive: true,
        },
      }),
    ),
  );

  /* ── Products ───────────────────────────────────────────────────── */
  const products: { id: string; price: Prisma.Decimal; stock: number }[] = [];
  let sku = 1;

  for (const [index, category] of categories.entries()) {
    const slug = CATEGORIES[index]?.slug ?? '';

    for (const name of PRODUCT_NAMES[slug] ?? []) {
      const price = money(random.int(1500, 45_000) / 100);
      // A deliberate spread: some healthy, some low, a couple at zero — so the
      // low-stock view and the zero-stock styling both have something to show.
      const stock = random.chance(0.15) ? random.int(0, 4) : random.int(12, 240);

      const product = await prisma.product.create({
        data: {
          name,
          sku: DEMO.sku(sku),
          description: `${name} — demo catalogue item.`,
          price,
          stock,
          status: random.chance(0.1) ? ProductStatus.DRAFT : ProductStatus.ACTIVE,
          categoryId: category.id,
        },
      });

      // An opening balance, so `/reconcile` agrees from the start rather than
      // reporting drift on every demo product.
      await prisma.stockMovement.create({
        data: {
          productId: product.id,
          delta: stock,
          reason: StockMovementReason.CORRECTION,
          note: 'Opening balance (demo data)',
        },
      });

      products.push({ id: product.id, price, stock });
      sku += 1;
    }
  }

  /* ── Customers ──────────────────────────────────────────────────── */
  const customers = await Promise.all(
    Array.from({ length: 32 }, (_, index) => {
      const first = random.pick(FIRST_NAMES);
      const last = random.pick(LAST_NAMES);

      return prisma.customer.create({
        data: {
          name: `${first} ${last}`,
          email: DEMO.email(`${first}.${last}.${String(index)}`.toLowerCase()),
          phone: `+9715${String(random.int(10_000_000, 99_999_999))}`,
          city: random.pick(CITIES),
          country: 'AE',
          // Spread across the window so "new customers" is not a flat line.
          createdAt: daysAgo(random.int(0, DAYS_OF_HISTORY)),
        },
      });
    }),
  );

  /* ── Couriers ───────────────────────────────────────────────────── */
  const couriers = await Promise.all(
    ['Sami Haddad', 'Rami Nasser', 'Faris Aziz'].map((name, index) =>
      prisma.deliveryStaff.create({
        data: {
          name,
          email: DEMO.email(name.toLowerCase().replace(/\s+/g, '.')),
          phone: `+9715${String(random.int(10_000_000, 99_999_999))}`,
          vehicleType: random.pick(['Van', 'Motorbike', 'Car']),
          zone: random.pick(['Marina', 'Downtown', 'Deira']),
          country: 'AE',
          status: index === 2 ? DeliveryStaffStatus.INACTIVE : DeliveryStaffStatus.ACTIVE,
          // No access code: issuing one is a deliberate action, and a seeded
          // credential is a credential nobody chose.
        },
      }),
    ),
  );

  const activeCouriers = couriers.filter(
    (courier) => courier.status !== DeliveryStaffStatus.INACTIVE,
  );

  /* ── Orders ─────────────────────────────────────────────────────── */
  /**
   * Weighted so the mix looks like a real business rather than a uniform
   * spread: mostly delivered, a few in flight, some cancelled, rare returns.
   */
  const STATUS_WEIGHTS: [OrderStatus, number][] = [
    [OrderStatus.DELIVERED, 0.62],
    [OrderStatus.SHIPPED, 0.12],
    [OrderStatus.CONFIRMED, 0.09],
    [OrderStatus.PENDING, 0.07],
    [OrderStatus.CANCELED, 0.07],
    [OrderStatus.RETURNED, 0.03],
  ];

  function pickStatus(): OrderStatus {
    const roll = random.next();
    let cumulative = 0;

    for (const [status, weight] of STATUS_WEIGHTS) {
      cumulative += weight;
      if (roll < cumulative) return status;
    }

    return OrderStatus.DELIVERED;
  }

  for (let index = 0; index < ORDER_COUNT; index += 1) {
    // Skewed toward recent: a business that grew, so the revenue chart has a
    // direction rather than being noise around a flat line.
    const age = Math.floor(DAYS_OF_HISTORY * random.next() ** 1.6);
    const placedAt = daysAgo(age);
    const status = pickStatus();
    const customer = random.pick(customers);

    const lineCount = random.int(1, 4);
    const lines = Array.from({ length: lineCount }, () => {
      const product = random.pick(products);
      const quantity = random.int(1, 3);
      return { product, quantity };
    });

    const total = lines.reduce(
      (sum, line) => sum.plus(line.product.price.times(line.quantity)),
      new Prisma.Decimal(0),
    );

    const order = await prisma.order.create({
      data: {
        orderNumber: DEMO.orderNumber(index + 1),
        // Denormalised on purpose — the reports read THIS, never a recomputation.
        total,
        status,
        paymentMethod: random.pick(['card', 'cash', 'transfer']),
        placedAt,
        customerId: customer.id,
        items: {
          create: lines.map((line) => ({
            productId: line.product.id,
            quantity: line.quantity,
            // Price AT TIME OF ORDER. Editing a product later must not move this.
            price: line.product.price,
          })),
        },
      },
    });

    /* Status history — an audit trail that actually explains each order. */
    const journey: OrderStatus[] = [];
    if (status === OrderStatus.CANCELED) {
      journey.push(OrderStatus.CONFIRMED, OrderStatus.CANCELED);
    } else if (status === OrderStatus.RETURNED) {
      journey.push(
        OrderStatus.CONFIRMED,
        OrderStatus.SHIPPED,
        OrderStatus.DELIVERED,
        OrderStatus.RETURNED,
      );
    } else {
      const path = [
        OrderStatus.CONFIRMED,
        OrderStatus.SHIPPED,
        OrderStatus.DELIVERED,
      ];
      journey.push(...path.slice(0, path.indexOf(status) + 1));
    }

    let previous: OrderStatus = OrderStatus.PENDING;
    for (const [step, to] of journey.entries()) {
      await prisma.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: previous,
          toStatus: to,
          createdAt: new Date(placedAt.getTime() + (step + 1) * 3_600_000),
          note: to === OrderStatus.CANCELED ? 'Customer requested cancellation' : null,
        },
      });
      previous = to;
    }

    /* A courier for orders that actually left the building. */
    if (
      activeCouriers.length > 0 &&
      [OrderStatus.SHIPPED, OrderStatus.DELIVERED].includes(status)
    ) {
      await prisma.deliveryAssignment.create({
        data: {
          orderId: order.id,
          driverId: random.pick(activeCouriers).id,
          customerName: customer.name,
          customerPhone: customer.phone,
          address: `${String(random.int(1, 200))} Demo Street`,
          city: customer.city,
          country: 'AE',
          total,
          paymentMethod: 'card',
          status:
            status === OrderStatus.DELIVERED
              ? DeliveryStatus.DELIVERED
              : DeliveryStatus.OUT_FOR_DELIVERY,
        },
      });
    }
  }

  /* ── Reviews, discounts, notifications ──────────────────────────── */
  await Promise.all(
    Array.from({ length: 24 }, () => {
      const product = random.pick(products);
      const customer = random.pick(customers);

      return prisma.review.create({
        data: {
          productId: product.id,
          customerId: customer.id,
          rating: random.int(3, 5),
          body: random.pick([
            'Exactly as described, arrived quickly.',
            'Good quality for the price.',
            'Packaging was damaged but the item is fine.',
            'Would buy again.',
          ]),
          status: random.chance(0.2) ? ReviewStatus.PENDING : ReviewStatus.APPROVED,
          createdAt: daysAgo(random.int(0, 90)),
        },
      });
    }),
  );

  await Promise.all([
    prisma.discount.create({
      data: {
        code: DEMO.discountCode('WELCOME10'),
        type: DiscountType.PERCENT,
        value: money(10),
        maxUses: 500,
        usedCount: random.int(20, 180),
        expiresAt: daysAgo(-45),
        isActive: true,
      },
    }),
    prisma.discount.create({
      data: {
        code: DEMO.discountCode('FREESHIP'),
        type: DiscountType.FIXED,
        value: money(25),
        maxUses: 200,
        usedCount: random.int(5, 60),
        expiresAt: daysAgo(14), // Expired, so the UI has one of each.
        isActive: false,
      },
    }),
  ]);

  await Promise.all(
    [
      { type: 'order', title: 'New order received', link: '/admin/orders' },
      { type: 'inventory', title: 'A product is running low', link: '/admin/inventory' },
      { type: 'review', title: 'A review is awaiting approval', link: '/admin/r/reviews' },
    ].map((notification, index) =>
      prisma.notification.create({
        data: {
          ...notification,
          body: `${DEMO_TAG} sample notification.`,
          isRead: index === 2,
          createdAt: daysAgo(index),
        },
      }),
    ),
  );

  /* ── Report ─────────────────────────────────────────────────────── */
  const [orderCount, productCount, customerCount] = await Promise.all([
    prisma.order.count({ where: { orderNumber: { startsWith: DEMO_TAG } } }),
    prisma.product.count({ where: { sku: { startsWith: DEMO_TAG } } }),
    prisma.customer.count({ where: { email: { contains: DEMO_TAG } } }),
  ]);

  process.stdout.write(
    `\n  seeded: ${String(productCount)} products, ${String(customerCount)} customers, ` +
      `${String(orderCount)} orders across ${String(DAYS_OF_HISTORY)} days\n` +
      `  every row is tagged "${DEMO_TAG}" — remove with prisma/demo-teardown.ts\n`,
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `\n  demo seed failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
