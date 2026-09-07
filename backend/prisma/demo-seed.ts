import 'dotenv/config';

import { pathToFileURL } from 'node:url';

import bcrypt from 'bcryptjs';

import {
  DeliveryStaffStatus,
  DeliveryStatus,
  DiscountType,
  OrderStatus,
  Prisma,
  PrismaClient,
  ProductStatus,
  ReturnCategory,
  ReturnResolution,
  ReturnStatus,
  ReviewStatus,
  StaffRole,
  StockMovementReason,
} from '@prisma/client';

import { DEMO, DEMO_TAG, makeRandom } from './demo-data.js';
import { SETTINGS } from '../src/config/settings.config.js';

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
  // A public demo deployment is the one legitimate reason to want demo rows in
  // a NODE_ENV=production database: showing the dashboard with data in it is
  // the entire point of that instance. It stays opt-in and explicit — nobody
  // reaches this by muscle memory, only by setting the variable deliberately.
  // The `defaultdb` check below is NOT relaxed by it.
  const demoDeployment = process.env.DEMO_DEPLOYMENT === '1';

  if (process.env.NODE_ENV === 'production' && !demoDeployment) {
    throw new Error(
      'Refusing to seed demo data with NODE_ENV=production. If this really is a ' +
        'public demo instance, set DEMO_DEPLOYMENT=1 to allow it.',
    );
  }

  const url = process.env.DATABASE_URL ?? '';
  const database = /\/([^/?]+)(\?|$)/.exec(url)?.[1];

  if (!database) {
    throw new Error('Could not determine the target database from DATABASE_URL.');
  }

  /**
   * Named databases this must never write to.
   *
   * `defaultdb` was Aiven's shared database, which held another project's live
   * tables; Aiven is gone but the name is kept because a copied .env is
   * exactly the accident this guards against, and the check costs nothing.
   *
   * `default` is the Coolify MySQL's database name and IS PRODUCTION for this
   * app (owner, 2026-09-05 — there is no dev database). Seeding it would put
   * `__demo__` rows into the real catalogue, which reads as a data-entry
   * mistake rather than a script, and would double every figure in the
   * owner's reports.
   */
  const FORBIDDEN_DATABASES = ['defaultdb', 'default'];

  if (FORBIDDEN_DATABASES.includes(database)) {
    throw new Error(
      `Refusing to seed: \`${database}\` holds live data, not demo data.`,
    );
  }

  process.stdout.write(`  target database: ${database}\n`);
}

export async function seedDemoData() {
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

  /* ── Businesses and branches (F8) ───────────────────────────────── */
  /**
   * TWO businesses, because one proves nothing.
   *
   * Business isolation is a security property, not a feature: a missed scope
   * filter shows one owner another owner's revenue, and that failure is
   * silent — nothing errors, the numbers are just wrong and confidential.
   * With a single business every isolation bug is invisible, because there is
   * no second business whose rows could leak into the first.
   *
   * The cafe gets THREE branches (two shops + a warehouse) so per-branch
   * stock, the `isSellingPoint` distinction and the branch switcher all have
   * something real to show. The restaurant gets one, and its own catalogue —
   * it exists to be the thing that must never appear in the cafe's reports.
   */
  const cafe = await prisma.business.create({
    data: {
      name: DEMO.businessName('Rise & Grind Coffee'),
      kind: 'cafe',
      legalName: 'Rise & Grind Trading LLC',
      taxId: 'TRN-100234567800003',
      email: DEMO.email('cafe-contact'),
      phone: '+971 4 555 0100',
      addressLine: 'Unit 4, Marina Walk',
      city: 'Dubai',
      country: 'AE',
      currency: 'AED',
      timezone: 'Asia/Dubai',
    },
  });

  const restaurant = await prisma.business.create({
    data: {
      name: DEMO.businessName('Olive Tree Kitchen'),
      kind: 'restaurant',
      legalName: 'Olive Tree Hospitality LLC',
      taxId: 'TRN-100987654300003',
      email: DEMO.email('kitchen-contact'),
      phone: '+971 2 555 0200',
      addressLine: '12 Corniche Road',
      city: 'Abu Dhabi',
      country: 'AE',
      currency: 'AED',
      timezone: 'Asia/Dubai',
    },
  });

  /**
   * `isDefault` is set EXPLICITLY on exactly one branch, never inferred from
   * "oldest". Ordering by `createdAt` looked equivalent and was not: the
   * seeded branch in the migration is written with MySQL `NOW(3)` (server
   * local time) while Prisma writes real UTC, so on a UTC+4 machine the
   * "oldest" branch sorted LAST and stock landed at the wrong branch with
   * nothing erroring. A flag cannot drift with a timezone.
   */
  const marina = await prisma.branch.create({
    data: {
      businessId: cafe.id,
      name: DEMO.branchName('Marina'),
      code: 'MAR',
      addressLine: 'Unit 4, Marina Walk',
      city: 'Dubai',
      phone: '+971 4 555 0101',
      isSellingPoint: true,
      isDefault: true,
    },
  });

  const downtown = await prisma.branch.create({
    data: {
      businessId: cafe.id,
      name: DEMO.branchName('Downtown'),
      code: 'DTN',
      addressLine: 'Boulevard Plaza, Downtown',
      city: 'Dubai',
      phone: '+971 4 555 0102',
      isSellingPoint: true,
    },
  });

  /**
   * A warehouse is a branch that does not sell — `isSellingPoint: false`
   * rather than a separate model that would duplicate every stock relation.
   * It holds stock and takes no orders, so a report counting "shops" can
   * filter on the flag instead of hard-coding a name convention.
   */
  const warehouse = await prisma.branch.create({
    data: {
      businessId: cafe.id,
      name: DEMO.branchName('Al Quoz Warehouse'),
      code: 'WH1',
      addressLine: 'Warehouse 7, Al Quoz Industrial 3',
      city: 'Dubai',
      isSellingPoint: false,
    },
  });

  /** The other business's single branch — the one that must never leak. */
  const corniche = await prisma.branch.create({
    data: {
      businessId: restaurant.id,
      name: DEMO.branchName('Corniche'),
      code: 'CRN',
      addressLine: '12 Corniche Road',
      city: 'Abu Dhabi',
      phone: '+971 2 555 0201',
      isSellingPoint: true,
      isDefault: true,
    },
  });

  /** Selling branches only — a warehouse takes no orders. */
  const cafeSellingBranches = [marina, downtown];

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
  const products: {
    id: string;
    price: Prisma.Decimal;
    // Null for a deliberate minority of demo products — see the note where
    // this is generated. Margin reporting must have both cases to show.
    cost: Prisma.Decimal | null;
    stock: number;
  }[] = [];
  let sku = 1;

  for (const [index, category] of categories.entries()) {
    const slug = CATEGORIES[index]?.slug ?? '';

    for (const name of PRODUCT_NAMES[slug] ?? []) {
      const price = money(random.int(1500, 45_000) / 100);
      /**
       * Cost is 45-75% of price, so gross margin lands in a believable
       * 25-55% band rather than a uniform figure that makes the margin
       * report look computed rather than real.
       *
       * 15% are left with NO cost on purpose. `Product.cost` is nullable
       * by design ("not tracked yet", never a fabricated 0) and the margin
       * report's excluded-lines count exists precisely to surface that gap
       * — seeding every product with a cost would leave that path with
       * nothing to show and let a regression in it go unnoticed.
       */
      // Decimal arithmetic via .times()/.dividedBy(), never `*` — see the
      // money convention at the top of schema.prisma.
      const cost = random.chance(0.15)
        ? null
        : price.times(random.int(45, 75)).dividedBy(100).toDecimalPlaces(2);
      // A deliberate spread: some healthy, some low, a couple at zero — so the
      // low-stock view and the zero-stock styling both have something to show.
      const stock = random.chance(0.15) ? random.int(0, 4) : random.int(12, 240);

      const product = await prisma.product.create({
        data: {
          name,
          sku: DEMO.sku(sku),
          description: `${name} — demo catalogue item.`,
          price,
          cost,
          stock,
          status: random.chance(0.1) ? ProductStatus.DRAFT : ProductStatus.ACTIVE,
          categoryId: category.id,
        },
      });

      /**
       * Opening balance, SPLIT ACROSS BRANCHES (F8.2).
       *
       * `Product.stock` stays the all-branch total, and `BranchStock` holds
       * each branch's share — three numbers that must always agree:
       *   movements (per branch) -> BranchStock.quantity -> Product.stock
       *
       * Seeding one unattributed movement would leave every per-branch view
       * empty and `reconcile()` unable to prove the second link, so the split
       * is real rather than cosmetic. The remainder goes to the warehouse,
       * which is where unsold stock genuinely sits.
       */
      const atMarina = Math.round(stock * 0.4);
      const atDowntown = Math.round(stock * 0.35);
      const atWarehouse = stock - atMarina - atDowntown;

      for (const [branch, quantity] of [
        [marina, atMarina],
        [downtown, atDowntown],
        [warehouse, atWarehouse],
      ] as const) {
        if (quantity <= 0) continue;

        await prisma.stockMovement.create({
          data: {
            productId: product.id,
            branchId: branch.id,
            delta: quantity,
            reason: StockMovementReason.CORRECTION,
            note: 'Opening balance (demo data)',
          },
        });

        await prisma.branchStock.create({
          data: { productId: product.id, branchId: branch.id, quantity },
        });
      }

      products.push({ id: product.id, price, cost, stock });
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

  // Same "missing row means never-changed default" rule getSettingValue()
  // uses — read once, not per order, since the rate does not change mid-seed.
  const taxRateSetting = await prisma.setting.findUnique({
    where: { key: 'store.taxRate' },
    select: { value: true },
  });
  const taxRatePercent = Number(
    taxRateSetting === null ? SETTINGS['store.taxRate'].default : taxRateSetting.value,
  );
  const taxRate = new Prisma.Decimal(taxRatePercent).dividedBy(100);

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

    const subtotal = lines.reduce(
      (sum, line) => sum.plus(line.product.price.times(line.quantity)),
      new Prisma.Decimal(0),
    );
    // Rounded once at order creation and snapshotted, same discipline as
    // OrderItem.price — a later change to store.taxRate must not reach back
    // and rewrite what this order already showed.
    const taxAmount = subtotal.times(taxRate).toDecimalPlaces(2);
    const total = subtotal.plus(taxAmount);

    const order = await prisma.order.create({
      data: {
        orderNumber: DEMO.orderNumber(index + 1),
        // Denormalised on purpose — the reports read THIS, never a recomputation.
        total,
        subtotal,
        taxAmount,
        status,
        paymentMethod: random.pick(['card', 'cash', 'transfer']),
        placedAt,
        customerId: customer.id,
        /**
         * Which branch took the order (F8.3). Selling branches only — a
         * warehouse takes no orders.
         *
         * ~8% are left NULL deliberately. A null branch means UNATTRIBUTED,
         * which is a real state (orders taken before branches existed) and a
         * branch-scoped report must EXCLUDE them rather than folding them
         * into whichever branch was asked for. Seeding every order with a
         * branch would leave that path untested and let a regression that
         * invents revenue for a branch go unnoticed.
         */
        branchId: random.chance(0.08) ? null : random.pick(cafeSellingBranches).id,
        items: {
          create: lines.map((line) => ({
            productId: line.product.id,
            quantity: line.quantity,
            // Price AT TIME OF ORDER. Editing a product later must not move this.
            price: line.product.price,
            // Cost AT TIME OF ORDER, same rule (F1.1). Null where the product
            // has no cost tracked — never substituted with 0, which would
            // report the sale as pure profit.
            cost: line.product.cost,
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

  /* ── Staff ──────────────────────────────────────────────────────── */
  /**
   * One person per role, so the permissions matrix, the "view as role"
   * preview and the staff table all have real rows rather than a single
   * OWNER talking to itself.
   *
   * DEVELOPER and OWNER are deliberately NOT seeded: the real admin comes
   * from seed.ts (SEED_ADMIN_EMAIL), and a second account at that rank would
   * be a genuine privilege surface in anything that outlives the demo.
   *
   * Every password is the same throwaway string and every account is tagged,
   * so these can only sign in on a machine that has run the demo seeder, and
   * teardown removes them. `lastLoginAt` is staggered so the F2 login-history
   * and last-seen columns show a spread rather than one identical timestamp.
   */
  const staffPasswordHash = await bcrypt.hash('DemoStaff!2026', 10);

  const staff = await Promise.all(
    (
      [
        { slug: 'manager', name: 'Layla Nasser', role: StaffRole.MANAGER, daysSinceLogin: 0 },
        { slug: 'fulfillment', name: 'Omar Haddad', role: StaffRole.FULFILLMENT, daysSinceLogin: 1 },
        { slug: 'support', name: 'Sara Aziz', role: StaffRole.SUPPORT, daysSinceLogin: 3 },
        { slug: 'viewer', name: 'Demo Viewer', role: StaffRole.DEMO, daysSinceLogin: 12 },
      ] as const
    ).map((person) =>
      prisma.user.create({
        data: {
          email: DEMO.staffEmail(person.slug),
          name: person.name,
          phone: `+971 50 555 0${String(random.int(100, 999))}`,
          passwordHash: staffPasswordHash,
          role: person.role,
          // One deactivated account, so the staff table's inactive styling and
          // the "cannot sign in" path both have something to show.
          isActive: person.role !== StaffRole.DEMO,
          lastLoginAt: daysAgo(person.daysSinceLogin),
        },
      }),
    ),
  );

  /* ── Product variants ───────────────────────────────────────────── */
  /**
   * Variants on a handful of products only. Every product having variants
   * would be unrealistic and would hide the plain-product path, which is what
   * most of the catalogue is.
   *
   * `ProductVariant.stock` is its OWN denormalised total with its own
   * movement ledger (`variants.service.ts` writes rows keyed by variant) — it
   * is not a slice of `Product.stock`, and `BranchStock` has no variant
   * dimension, which is why `getVariantStockMovement` reports an all-branch
   * figure and says so in its column name.
   */
  const variantProducts = products.slice(0, 6);
  let variantSku = 1;

  for (const product of variantProducts) {
    for (const suffix of ['SM', 'MD', 'LG'] as const) {
      const variantStock = random.int(4, 60);
      const multiplier = suffix === 'SM' ? 90 : suffix === 'MD' ? 100 : 118;

      const variant = await prisma.productVariant.create({
        data: {
          productId: product.id,
          name: { SM: 'Small', MD: 'Medium', LG: 'Large' }[suffix],
          sku: DEMO.variantSku(variantSku, suffix),
          // Larger sizes cost more — a flat price across variants would make
          // any per-variant revenue report look broken.
          price: product.price.times(multiplier).dividedBy(100).toDecimalPlaces(2),
          stock: variantStock,
        },
      });

      await prisma.stockMovement.create({
        data: {
          variantId: variant.id,
          branchId: marina.id,
          delta: variantStock,
          reason: StockMovementReason.CORRECTION,
          note: 'Opening balance (demo data)',
        },
      });
    }
    variantSku += 1;
  }

  /* ── Returns ────────────────────────────────────────────────────── */
  /**
   * Returns against orders that actually reached DELIVERED — a return on a
   * PENDING order is not a state the app can produce, and seeding one would
   * make the returns report describe something impossible.
   *
   * All three statuses appear, and every resolution path, because the returns
   * dashboard splits on exactly those. `rejectionReason` is set on every
   * REJECTED row (the API requires it) and `refundAmount` only where the
   * resolution is actually a refund.
   */
  const deliveredOrders = await prisma.order.findMany({
    where: {
      orderNumber: { startsWith: DEMO_TAG },
      status: OrderStatus.DELIVERED,
    },
    select: {
      id: true,
      customerId: true,
      total: true,
      items: { select: { id: true, quantity: true } },
    },
    take: 14,
  });

  let rma = 1;

  for (const order of deliveredOrders) {
    const roll = random.next();
    const status =
      roll < 0.45
        ? ReturnStatus.APPROVED
        : roll < 0.75
          ? ReturnStatus.REQUESTED
          : ReturnStatus.REJECTED;

    const resolution =
      status === ReturnStatus.APPROVED
        ? random.pick([
            ReturnResolution.REFUND,
            ReturnResolution.STORE_CREDIT,
            ReturnResolution.REPLACEMENT,
          ])
        : ReturnResolution.NONE;

    const created = await prisma.return.create({
      data: {
        rmaNumber: DEMO.rmaNumber(rma),
        reason: random.pick([
          'Arrived with a cracked lid',
          'Wrong grind size sent',
          'Not what the photo showed',
          'Changed my mind after ordering',
          'Delivered three days late',
        ]),
        category: random.pick([
          ReturnCategory.DAMAGED,
          ReturnCategory.WRONG_ITEM,
          ReturnCategory.NOT_AS_DESCRIBED,
          ReturnCategory.NO_LONGER_NEEDED,
          ReturnCategory.ARRIVED_LATE,
        ]),
        status,
        resolution,
        // Half the order, so it is always within the cap the approve path
        // enforces (the returned lines' recorded price, never the live total).
        refundAmount:
          resolution === ReturnResolution.REFUND
            ? order.total.dividedBy(2).toDecimalPlaces(2)
            : null,
        restocked: resolution === ReturnResolution.REFUND,
        rejectionReason:
          status === ReturnStatus.REJECTED ? 'Outside the 14-day return window.' : null,
        orderId: order.id,
        customerId: order.customerId,
        createdAt: daysAgo(random.int(1, 60)),
      },
    });

    const line = order.items[0];
    if (line) {
      await prisma.returnItem.create({
        data: {
          returnId: created.id,
          orderItemId: line.id,
          quantity: Math.max(1, Math.min(line.quantity, random.int(1, 2))),
        },
      });
    }

    rma += 1;
  }

  /* ── Order notes ────────────────────────────────────────────────── */
  /**
   * A THREAD, not a single overwritable field — so the order detail page's
   * note list has more than one entry to render and its ordering is actually
   * exercised. Attributed to seeded staff, which is also what gives the audit
   * and staff-activity views a non-OWNER actor to report.
   */
  const notableOrders = await prisma.order.findMany({
    where: { orderNumber: { startsWith: DEMO_TAG } },
    select: { id: true },
    take: 10,
  });

  for (const order of notableOrders) {
    const author = random.pick(staff);

    for (const [index, body] of [
      'Customer called to confirm the delivery window.',
      'Rescheduled to the afternoon slot at their request.',
    ].entries()) {
      await prisma.orderNote.create({
        data: {
          orderId: order.id,
          body: `${body} (${DEMO_TAG})`,
          authorId: author.id,
          createdAt: daysAgo(Math.max(1, random.int(2, 30) - index)),
        },
      });
    }
  }

  /* ── The second business's own data (F8 isolation) ──────────────── */
  /**
   * The restaurant gets its OWN catalogue, its own stock and its own orders.
   *
   * This is the point of seeding two businesses at all. Business isolation is
   * a security property: a missed scope filter shows one owner another
   * owner's revenue, and the failure is SILENT — nothing errors, the numbers
   * are just wrong and confidential. With only the cafe's rows in the
   * database there is nothing that could leak, so every isolation bug would
   * look exactly like correct behaviour.
   *
   * The figures are deliberately distinctive (a 4-item menu, round prices) so
   * a leak is arithmetically obvious in a report rather than blending into
   * the cafe's 140 orders. If "Mezze Platter" ever appears in a cafe report,
   * a filter is missing.
   */
  const kitchenCategory = await prisma.category.create({
    data: {
      name: 'Kitchen',
      slug: DEMO.categorySlug('kitchen'),
      description: 'Second-business menu — must never appear in the cafe reports.',
    },
  });

  const kitchenProducts = await Promise.all(
    [
      { name: 'Mezze Platter', price: 8500, cost: 3400 },
      { name: 'Lamb Ouzi', price: 14_500, cost: 6800 },
      { name: 'Fattoush', price: 3800, cost: 1400 },
      { name: 'Knafeh', price: 4200, cost: 1600 },
    ].map((item, index) =>
      prisma.product.create({
        data: {
          name: item.name,
          sku: DEMO.sku(900 + index),
          description: `${item.name} — second-business menu item.`,
          price: money(item.price / 100),
          cost: money(item.cost / 100),
          stock: 40,
          status: ProductStatus.ACTIVE,
          categoryId: kitchenCategory.id,
        },
      }),
    ),
  );

  for (const product of kitchenProducts) {
    await prisma.stockMovement.create({
      data: {
        productId: product.id,
        branchId: corniche.id,
        delta: 40,
        reason: StockMovementReason.CORRECTION,
        note: 'Opening balance (demo data)',
      },
    });

    await prisma.branchStock.create({
      data: { productId: product.id, branchId: corniche.id, quantity: 40 },
    });
  }

  /**
   * Orders on the OTHER business's branch. Every one of these must be absent
   * from any cafe-scoped report — that is the assertion the whole two-business
   * fixture exists to make checkable by eye.
   */
  for (let index = 0; index < 18; index += 1) {
    const line = random.pick(kitchenProducts);
    const quantity = random.int(1, 3);
    const subtotal = line.price.times(quantity).toDecimalPlaces(2);
    const taxAmount = subtotal.times(5).dividedBy(100).toDecimalPlaces(2);

    await prisma.order.create({
      data: {
        orderNumber: DEMO.orderNumber(9000 + index),
        total: subtotal.plus(taxAmount).toDecimalPlaces(2),
        subtotal,
        taxAmount,
        status: OrderStatus.DELIVERED,
        paymentMethod: random.pick(['card', 'cash']),
        placedAt: daysAgo(random.int(1, DAYS_OF_HISTORY)),
        branchId: corniche.id,
        items: {
          create: [
            {
              productId: line.id,
              quantity,
              price: line.price,
              cost: line.cost,
            },
          ],
        },
      },
    });
  }

  /* ── Report ─────────────────────────────────────────────────────── */
  const [
    orderCount,
    productCount,
    customerCount,
    branchCount,
    staffCount,
    returnCount,
    variantCount,
  ] = await Promise.all([
    prisma.order.count({ where: { orderNumber: { startsWith: DEMO_TAG } } }),
    prisma.product.count({ where: { sku: { startsWith: DEMO_TAG } } }),
    prisma.customer.count({ where: { email: { contains: DEMO_TAG } } }),
    prisma.branch.count({ where: { name: { startsWith: DEMO_TAG } } }),
    prisma.user.count({ where: { email: { contains: DEMO_TAG } } }),
    prisma.return.count({ where: { rmaNumber: { startsWith: DEMO_TAG } } }),
    prisma.productVariant.count({ where: { sku: { startsWith: DEMO_TAG } } }),
  ]);

  process.stdout.write(
    `\n  seeded: ${String(productCount)} products, ${String(customerCount)} customers, ` +
      `${String(orderCount)} orders across ${String(DAYS_OF_HISTORY)} days\n` +
      `          2 businesses, ${String(branchCount)} branches, ${String(staffCount)} staff, ` +
      `${String(returnCount)} returns, ${String(variantCount)} variants\n` +
      `  every row is tagged "${DEMO_TAG}" — remove with prisma/demo-teardown.ts\n`,
  );
}

// Only self-run when invoked directly (`tsx prisma/demo-seed.ts`). When seed.ts
// imports seedDemoData(), it owns the lifecycle — running main() on import
// would seed twice and disconnect the client out from under the caller.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  seedDemoData()
    .catch((error: unknown) => {
      process.stderr.write(
        `\n  demo seed failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    })
    .finally(() => void prisma.$disconnect());
}
