/**
 * Seed script — creates the initial admin user plus a small, coherent set of
 * sample data so the dashboard has something to render during development.
 *
 * Run with: pnpm --filter ./backend db:seed
 *
 * SAFE TO RE-RUN. Every write is an upsert keyed on a natural unique field, so
 * running twice does not duplicate rows. It does NOT wipe the database — use
 * `pnpm prisma migrate reset` for that (dev only).
 *
 * The initial admin's password comes from SEED_ADMIN_PASSWORD. There is no
 * hardcoded fallback on purpose: a default password that works in production
 * is how dashboards get breached.
 */
import { PrismaClient, StaffRole, ProductStatus, OrderStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/** Deterministic slug so re-runs upsert rather than duplicate. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

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

  await prisma.user.upsert({
    where: { email },
    // Never reset an existing admin's password on re-seed — that would silently
    // lock someone out of a running environment.
    update: {},
    create: { email, name: 'Admin', role: StaffRole.OWNER, passwordHash },
  });

  console.log(`✔ admin user: ${email}`);
}

async function seedCatalogue(): Promise<void> {
  const categoryNames = ['Electronics', 'Apparel', 'Home & Garden'];

  const categories = await Promise.all(
    categoryNames.map((name) =>
      prisma.category.upsert({
        where: { slug: slugify(name) },
        update: {},
        create: { name, slug: slugify(name) },
      }),
    ),
  );

  // Decimal(10,2) money. Prisma accepts a JS number on write and converts it;
  // it returns a Decimal.js instance on read. See the arithmetic note below.
  const products = [
    { name: 'Wireless Headphones', sku: 'WH-001', price: 129.99, stock: 42, categoryIndex: 0 },
    { name: 'Mechanical Keyboard', sku: 'MK-002', price: 89.99, stock: 17, categoryIndex: 0 },
    { name: 'USB-C Hub', sku: 'UH-003', price: 49.99, stock: 0, categoryIndex: 0 },
    { name: 'Cotton T-Shirt', sku: 'CT-004', price: 24.99, stock: 130, categoryIndex: 1 },
    { name: 'Denim Jacket', sku: 'DJ-005', price: 79.99, stock: 8, categoryIndex: 1 },
    { name: 'Ceramic Planter', sku: 'CP-006', price: 34.99, stock: 55, categoryIndex: 2 },
  ] as const;

  for (const product of products) {
    const category = categories[product.categoryIndex];
    await prisma.product.upsert({
      where: { sku: product.sku },
      update: {},
      create: {
        name: product.name,
        sku: product.sku,
        price: product.price,
        stock: product.stock,
        // One product deliberately has stock 0 so empty/out-of-stock states
        // are visible during development rather than only in production.
        status: product.stock === 0 ? ProductStatus.DRAFT : ProductStatus.ACTIVE,
        categoryId: category?.id ?? null,
      },
    });
  }

  console.log(`✔ ${categories.length} categories, ${products.length} products`);
}

async function seedCustomersAndOrders(): Promise<void> {
  const customers = [
    { name: 'Sara Haddad', email: 'sara@example.com', city: 'Dubai', country: 'AE' },
    { name: 'Omar Nasser', email: 'omar@example.com', city: 'Amman', country: 'JO' },
    { name: 'Lina Farah', email: 'lina@example.com', city: 'Beirut', country: 'LB' },
  ] as const;

  const created = await Promise.all(
    customers.map((customer) =>
      prisma.customer.upsert({
        where: { email: customer.email },
        update: {},
        create: { ...customer },
      }),
    ),
  );

  const allProducts = await prisma.product.findMany({ take: 3 });

  // Spread across statuses so every badge tone and filter has real data behind
  // it. A dashboard seeded entirely with PENDING orders hides half the UI.
  const orders = [
    { number: 'ORD-1001', status: OrderStatus.DELIVERED, customerIndex: 0 },
    { number: 'ORD-1002', status: OrderStatus.SHIPPED, customerIndex: 1 },
    { number: 'ORD-1003', status: OrderStatus.PENDING, customerIndex: 2 },
    { number: 'ORD-1004', status: OrderStatus.CANCELED, customerIndex: 0 },
  ] as const;

  for (const order of orders) {
    const customer = created[order.customerIndex];
    const product = allProducts[0];
    if (!customer || !product) continue;

    const quantity = 2;
    // `product.price` is a Decimal.js instance, NOT a number — `price * qty`
    // would produce NaN. Use Decimal methods for money arithmetic, always.
    const total = product.price.times(quantity);

    await prisma.order.upsert({
      where: { orderNumber: order.number },
      update: {},
      create: {
        orderNumber: order.number,
        status: order.status,
        total,
        paymentMethod: 'card',
        customerId: customer.id,
        items: {
          create: [
            {
              productId: product.id,
              quantity,
              // Snapshot of the price at order time, not a live lookup.
              price: product.price,
            },
          ],
        },
      },
    });
  }

  console.log(`✔ ${created.length} customers, ${orders.length} orders`);
}

async function main(): Promise<void> {
  await seedAdminUser();
  await seedCatalogue();
  await seedCustomersAndOrders();
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
