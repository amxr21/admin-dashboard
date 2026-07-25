import { afterAll, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma.js';

/**
 * Schema behaviour tests.
 *
 * These do NOT test Prisma — they test the DESIGN DECISIONS encoded in
 * schema.prisma, which a future edit could silently reverse:
 *
 *   - `onDelete: SetNull` vs `Cascade` on each relation. Getting these
 *     backwards means either orphaned rows or, far worse, deleting a customer
 *     wiping their order history. Neither surfaces until it happens in prod.
 *   - Decimal money precision and arithmetic. `price * qty` on a Decimal
 *     silently produces garbage; these tests pin the correct behaviour.
 *   - Unique constraints that the API will rely on for conflict detection.
 *
 * ISOLATION: every record created here is namespaced with a unique run id and
 * removed in afterAll. Nothing touches seed data. Safe to run against the dev
 * database as well as CI's throwaway MySQL.
 */

// Unique per run so parallel runs and reruns never collide.
const RUN = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const tag = (name: string): string => `${RUN}-${name}`;

// Track what we create so cleanup removes exactly that and nothing else.
const created = {
  customerIds: [] as string[],
  productIds: [] as string[],
  categoryIds: [] as string[],
  orderIds: [] as string[],
};

afterAll(async () => {
  // Order matters: children before parents where the FK is restrictive.
  await prisma.orderItem.deleteMany({ where: { orderId: { in: created.orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: created.orderIds } } });
  await prisma.product.deleteMany({ where: { id: { in: created.productIds } } });
  await prisma.category.deleteMany({ where: { id: { in: created.categoryIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: created.customerIds } } });
  await prisma.$disconnect();
});

async function makeCustomer(label: string) {
  const customer = await prisma.customer.create({
    data: { name: tag(label), email: `${tag(label)}@example.test` },
  });
  created.customerIds.push(customer.id);
  return customer;
}

async function makeProduct(label: string, price = 19.99) {
  const product = await prisma.product.create({
    data: { name: tag(label), sku: tag(label), price },
  });
  created.productIds.push(product.id);
  return product;
}

describe('money is Decimal, not float', () => {
  it('stores a price at exactly 2 decimal places without drift', async () => {
    const product = await makeProduct('price-precision', 129.99);

    const read = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });

    // .toFixed avoids comparing Decimal instances by identity.
    expect(read.price.toFixed(2)).toBe('129.99');
  });

  it('multiplies without floating-point error', async () => {
    // 0.1 + 0.2 !== 0.3 in float. This is the whole reason for Decimal.
    const product = await makeProduct('price-arithmetic', 0.1);
    const read = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });

    const total = read.price.times(3);

    expect(total.toFixed(2)).toBe('0.30');
  });

  it('returns a Decimal instance, so `*` must never be used on it', async () => {
    const product = await makeProduct('price-type', 10.5);
    const read = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });

    // Guards the documented trap: this is NOT a number, so native arithmetic
    // is invalid. If a future change makes it a number, this test fails and
    // the schema comment needs updating with it.
    expect(Prisma.Decimal.isDecimal(read.price)).toBe(true);
    expect(typeof read.price).not.toBe('number');
  });
});

describe('onDelete behaviour', () => {
  it('preserves orders when their customer is deleted (SetNull)', async () => {
    // Accounting and history must outlive the customer record.
    const customer = await makeCustomer('order-survives');
    const order = await prisma.order.create({
      data: { orderNumber: tag('ORD-survives'), customerId: customer.id, total: 50 },
    });
    created.orderIds.push(order.id);

    await prisma.customer.delete({ where: { id: customer.id } });
    created.customerIds = created.customerIds.filter((id) => id !== customer.id);

    const read = await prisma.order.findUnique({ where: { id: order.id } });

    expect(read).not.toBeNull();
    expect(read?.customerId).toBeNull();
  });

  it('deletes order items when their order is deleted (Cascade)', async () => {
    // An order line has no meaning without its order — orphans would corrupt
    // every revenue query.
    const product = await makeProduct('cascade-product');
    const order = await prisma.order.create({
      data: {
        orderNumber: tag('ORD-cascade'),
        total: 20,
        items: { create: [{ productId: product.id, quantity: 1, price: 19.99 }] },
      },
    });

    const before = await prisma.orderItem.count({ where: { orderId: order.id } });
    expect(before).toBe(1);

    await prisma.order.delete({ where: { id: order.id } });

    const after = await prisma.orderItem.count({ where: { orderId: order.id } });
    expect(after).toBe(0);
  });

  it('preserves products when their category is deleted (SetNull)', async () => {
    const category = await prisma.category.create({
      data: { name: tag('cat'), slug: tag('cat') },
    });
    created.categoryIds.push(category.id);

    const product = await prisma.product.create({
      data: { name: tag('cat-product'), sku: tag('cat-product'), price: 5, categoryId: category.id },
    });
    created.productIds.push(product.id);

    await prisma.category.delete({ where: { id: category.id } });
    created.categoryIds = created.categoryIds.filter((id) => id !== category.id);

    const read = await prisma.product.findUnique({ where: { id: product.id } });

    expect(read).not.toBeNull();
    expect(read?.categoryId).toBeNull();
  });
});

describe('unique constraints the API will depend on', () => {
  it('rejects a duplicate customer email', async () => {
    const customer = await makeCustomer('dupe-email');

    // P2002 is Prisma's unique-constraint code — routes will translate this
    // into a 409, so the constraint must actually exist.
    await expect(
      prisma.customer.create({ data: { name: tag('dupe-2'), email: customer.email } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects a duplicate order number', async () => {
    const number = tag('ORD-unique');
    const order = await prisma.order.create({ data: { orderNumber: number, total: 1 } });
    created.orderIds.push(order.id);

    await expect(
      prisma.order.create({ data: { orderNumber: number, total: 2 } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});

describe('defaults', () => {
  it('defaults a new order to PENDING', async () => {
    const order = await prisma.order.create({
      data: { orderNumber: tag('ORD-default'), total: 1 },
    });
    created.orderIds.push(order.id);

    expect(order.status).toBe('PENDING');
  });

  // Not async: this reads generated schema metadata, it does not touch the DB.
  it('defaults a new user to MANAGER, the least-privileged writable role', () => {
    // Guards against a schema edit accidentally making OWNER the default,
    // which would silently over-privilege every new account.
    const field = Prisma.dmmf.datamodel.models
      .find((model) => model.name === 'User')
      ?.fields.find((f) => f.name === 'role');

    expect(field?.default).toBe('MANAGER');
  });
});
